import random
from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from django.conf import settings
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.coding_tasks.models import CodingTask
from apps.leaderboard.services import broadcast_leaderboard, sync_match_leaderboard
from apps.realtime.services import broadcast_room_event
from apps.submissions.models import Submission
from apps.rooms.models import Room, RoomMembership
from apps.rooms.services import ensure_room_admin

from .models import Match, MatchParticipant, Round, RoundParticipant


def ensure_match_admin(user, match):
    if match.room.creator_id != user.id and not user.is_staff:
        raise PermissionDenied('Only match room admin can perform this action.')


def _load_tasks(task_ids):
    if task_ids:
        tasks = list(CodingTask.objects.filter(id__in=task_ids))
        found_ids = {task.id for task in tasks}
        missing_ids = set(task_ids) - found_ids
        if missing_ids:
            raise ValidationError({'task_ids': f'Tasks not found: {sorted(missing_ids)}'})
        tasks_by_id = {task.id: task for task in tasks}
        return [tasks_by_id[task_id] for task_id in task_ids]

    tasks = list(CodingTask.objects.order_by('difficulty', 'created_at')[:5])
    if not tasks:
        raise ValidationError({'task_ids': 'Create at least one coding task before starting a match.'})
    return tasks


def _resolve_match_tasks(room, *, task_ids=None, round_count=None):
    if task_ids:
        tasks = _load_tasks(task_ids)
        if round_count is None:
            return tasks
        if round_count <= len(tasks):
            return tasks[:round_count]

        tasks_by_id = {task.id: task for task in tasks}
        default_tasks = list(
            CodingTask.objects.exclude(id__in=tasks_by_id.keys()).order_by('difficulty', 'created_at')
        )
        for task in default_tasks:
            tasks.append(task)
            if len(tasks) >= round_count:
                return tasks[:round_count]
        return tasks

    selected_task_ids = list(
        room.selected_tasks.order_by('position', 'created_at').values_list('task_id', flat=True)
    )
    if round_count is None:
        round_count = int(getattr(room, 'round_count', 5) or 5)

    selected_tasks = list(CodingTask.objects.filter(id__in=selected_task_ids))
    selected_by_id = {task.id: task for task in selected_tasks}
    ordered_tasks = [selected_by_id[task_id] for task_id in selected_task_ids if task_id in selected_by_id]

    if len(ordered_tasks) >= round_count:
        return ordered_tasks[:round_count]

    default_tasks = list(
        CodingTask.objects.exclude(id__in=[task.id for task in ordered_tasks]).order_by('difficulty', 'created_at')
    )
    for task in default_tasks:
        ordered_tasks.append(task)
        if len(ordered_tasks) >= round_count:
            return ordered_tasks[:round_count]

    if not ordered_tasks:
        raise ValidationError({'task_ids': 'Create at least one coding task before starting a match.'})
    return ordered_tasks


def _create_round_participants(round_obj, participants):
    RoundParticipant.objects.bulk_create(
        [
            RoundParticipant(round=round_obj, participant=participant)
            for participant in participants
        ],
        ignore_conflicts=True,
    )


@transaction.atomic
def start_match(user, room, task_ids=None, round_count=None):
    room = Room.objects.select_for_update().get(pk=room.pk)
    ensure_room_admin(user, room)

    if room.status != Room.Status.WAITING:
        raise ValidationError('Room is not waiting for a new match.')

    tasks = _resolve_match_tasks(room, task_ids=task_ids, round_count=round_count)
    memberships = list(
        RoomMembership.objects.select_related('user')
        .filter(room=room, status=RoomMembership.Status.ACTIVE)
        .exclude(user_id=room.creator_id)
        .order_by('joined_at')
    )
    random.shuffle(memberships)
    if not memberships:
        raise ValidationError('Cannot start a match without active players.')

    match = Match.objects.create(room=room, status=Match.Status.RUNNING, started_at=timezone.now())
    participants = [
        MatchParticipant.objects.create(match=match, user=membership.user)
        for membership in memberships
    ]

    rounds = []
    for number, task in enumerate(tasks, start=1):
        rounds.append(
            Round.objects.create(
                match=match,
                task=task,
                number=number,
                status=Round.Status.PENDING,
            )
        )

    first_round = rounds[0]
    first_round.status = Round.Status.RUNNING
    first_round.started_at = timezone.now()
    first_round.save(update_fields=['status', 'started_at'])
    _create_round_participants(first_round, participants)

    match.current_round = first_round
    match.save(update_fields=['current_round'])

    room.status = Room.Status.RUNNING
    room.save(update_fields=['status'])

    sync_match_leaderboard(match)
    round_duration_seconds = int(getattr(settings, 'MATCH_ROUND_DURATION_SECONDS', 300))
    broadcast_room_event(
        room.id,
        'match_started',
        {
            'match_id': match.id,
            'room_id': room.id,
            'started_at': match.started_at,
            'round_duration_seconds': round_duration_seconds,
            'current_round': {
                'round_id': first_round.id,
                'round_number': first_round.number,
                'started_at': first_round.started_at,
            },
        },
    )
    broadcast_room_event(
        room.id,
        'round_started',
        {
            'match_id': match.id,
            'round_id': first_round.id,
            'round_number': first_round.number,
            'started_at': first_round.started_at,
            'round_duration_seconds': round_duration_seconds,
        },
    )
    broadcast_leaderboard(match)
    return match


@transaction.atomic
def mark_player_solved(submission):
    participant = MatchParticipant.objects.select_for_update().get(
        match=submission.match,
        user=submission.user,
    )
    if participant.status != MatchParticipant.Status.ACTIVE:
        return participant

    round_state, _ = RoundParticipant.objects.select_for_update().get_or_create(
        round=submission.round,
        participant=participant,
    )
    should_advance = round_state.status not in [
        RoundParticipant.Status.SOLVED,
        RoundParticipant.Status.PASSED,
    ]
    if should_advance:
        participant.score += 100
        participant.solved_rounds += 1
        participant.total_solution_time += submission.execution_time
        participant.save(update_fields=['score', 'solved_rounds', 'total_solution_time'])

    round_state.status = RoundParticipant.Status.SOLVED
    round_state.solved_at = timezone.now()
    round_state.time_spent = submission.execution_time
    round_state.save(update_fields=['status', 'solved_at', 'time_spent'])
    sync_match_leaderboard(submission.match)
    if should_advance:
        broadcast_room_event(
            submission.match.room_id,
            'player_advanced',
            {
                'match_id': submission.match_id,
                'round_id': submission.round_id,
                'round_number': submission.round.number,
                'user_id': participant.user_id,
                'username': participant.user.get_username(),
                'round_level': min(participant.solved_rounds + 1, 5),
                'solved_count': participant.solved_rounds,
                'points': participant.score,
            },
        )
    return participant


def _rank_participants(participants):
    return sorted(
        participants,
        key=lambda participant: (
            participant.status == MatchParticipant.Status.LEFT,
            -participant.score,
            participant.total_solution_time,
            participant.joined_at,
            participant.id,
        ),
    )


def _participant_has_progress(participant):
    return participant.score > 0 or participant.solved_rounds > 0


def _select_winner(match, candidates=None):
    participants = list(candidates) if candidates is not None else list(
        MatchParticipant.objects.filter(match=match).select_related('user')
    )
    eligible = [participant for participant in participants if participant.status != MatchParticipant.Status.LEFT]
    if not eligible:
        return None
    leader = _rank_participants(eligible)[0]
    if not _participant_has_progress(leader):
        return None
    return leader.user


def _finish_match(match, winner=None, candidates=None, auto_select_winner=True):
    if winner is None and auto_select_winner:
        winner = _select_winner(match, candidates)

    match.status = Match.Status.FINISHED
    match.finished_at = timezone.now()
    match.winner = winner
    match.save(update_fields=['status', 'finished_at', 'winner'])

    if match.current_round and match.current_round.status != Round.Status.FINISHED:
        match.current_round.status = Round.Status.FINISHED
        match.current_round.ended_at = timezone.now()
        match.current_round.save(update_fields=['status', 'ended_at'])

    if winner:
        now = timezone.now()
        MatchParticipant.objects.filter(match=match, user=winner).update(
            status=MatchParticipant.Status.WINNER,
            eliminated_at=None,
        )
        MatchParticipant.objects.filter(match=match).exclude(user=winner).exclude(
            status=MatchParticipant.Status.LEFT
        ).update(status=MatchParticipant.Status.ELIMINATED, eliminated_at=now)
    else:
        MatchParticipant.objects.filter(match=match).exclude(
            status=MatchParticipant.Status.LEFT
        ).update(status=MatchParticipant.Status.ELIMINATED, eliminated_at=timezone.now())

    match.room.status = Room.Status.FINISHED
    match.room.save(update_fields=['status'])
    RoomMembership.objects.filter(room=match.room, status=RoomMembership.Status.ACTIVE).update(is_ready=False)
    sync_match_leaderboard(match)
    broadcast_leaderboard(match)
    broadcast_room_event(
        match.room_id,
        'match_finished',
        {
            'match_id': match.id,
            'room_id': match.room_id,
            'winner_id': winner.id if winner else None,
            'username': winner.get_username() if winner else None,
            'room_status': match.room.status,
        },
    )
    return match


def _advance_round_locked(match):
    if match.status != Match.Status.RUNNING:
        raise ValidationError('Match is not running.')
    if not match.current_round:
        raise ValidationError('Match has no current round.')

    current_round = match.current_round
    active_participants = list(
        MatchParticipant.objects.select_for_update()
        .filter(match=match, status=MatchParticipant.Status.ACTIVE)
        .select_related('user')
    )

    for participant in active_participants:
        round_state, _ = RoundParticipant.objects.select_for_update().get_or_create(
            round=current_round,
            participant=participant,
        )
        if round_state.status not in [RoundParticipant.Status.SOLVED, RoundParticipant.Status.PASSED]:
            participant.status = MatchParticipant.Status.ELIMINATED
            participant.eliminated_at = timezone.now()
            participant.save(update_fields=['status', 'eliminated_at'])
            round_state.status = RoundParticipant.Status.ELIMINATED
            round_state.save(update_fields=['status'])
            broadcast_room_event(
                match.room_id,
                'player_eliminated',
                {
                    'match_id': match.id,
                    'user_id': participant.user_id,
                    'username': participant.user.get_username(),
                    'round_id': current_round.id,
                    'round_number': current_round.number,
                    'round_level': min(participant.solved_rounds + 1, 5),
                },
            )

    current_round.status = Round.Status.FINISHED
    current_round.ended_at = timezone.now()
    current_round.save(update_fields=['status', 'ended_at'])

    remaining = list(
        MatchParticipant.objects.filter(match=match, status=MatchParticipant.Status.ACTIVE).select_related('user')
    )
    next_round = match.rounds.filter(number__gt=current_round.number).order_by('number').first()

    if len(remaining) <= 1 or not next_round:
        winner = remaining[0].user if remaining else None
        return _finish_match(match, winner, candidates=remaining or None)

    next_round.status = Round.Status.RUNNING
    next_round.started_at = timezone.now()
    next_round.save(update_fields=['status', 'started_at'])
    _create_round_participants(next_round, remaining)

    match.current_round = next_round
    match.save(update_fields=['current_round'])

    sync_match_leaderboard(match)
    round_duration_seconds = int(getattr(settings, 'MATCH_ROUND_DURATION_SECONDS', 300))
    broadcast_room_event(
        match.room_id,
        'round_started',
        {
            'match_id': match.id,
            'round_id': next_round.id,
            'round_number': next_round.number,
            'started_at': next_round.started_at,
            'round_duration_seconds': round_duration_seconds,
        },
    )
    broadcast_leaderboard(match)
    return match


def _all_active_participants_resolved_for_round(match, round_obj):
    active_participants = list(
        MatchParticipant.objects.filter(match=match, status=MatchParticipant.Status.ACTIVE).values_list('id', flat=True)
    )
    if not active_participants:
        return True

    resolved_participant_ids = set(
        RoundParticipant.objects.filter(
            round=round_obj,
            participant_id__in=active_participants,
            status__in=[
                RoundParticipant.Status.SOLVED,
                RoundParticipant.Status.PASSED,
                RoundParticipant.Status.ELIMINATED,
            ],
        ).values_list('participant_id', flat=True)
    )
    if len(resolved_participant_ids) == len(active_participants):
        return True

    reviewed_submission_participant_ids = set(
        MatchParticipant.objects.filter(
            id__in=active_participants,
            user__submissions__match=match,
            user__submissions__round=round_obj,
            user__submissions__manual_decision__in=[
                Submission.ManualDecision.ACCEPTED,
                Submission.ManualDecision.REJECTED,
            ],
        ).values_list('id', flat=True)
    )

    return len(resolved_participant_ids | reviewed_submission_participant_ids) == len(active_participants)


@transaction.atomic
def maybe_auto_advance_round(user, match):
    match = Match.objects.select_for_update().select_related('room', 'current_round').get(pk=match.pk)

    if match.status != Match.Status.RUNNING or not match.current_round:
        return match

    is_participant = MatchParticipant.objects.filter(match=match, user=user).exists()
    if match.room.creator_id != user.id and not user.is_staff and not is_participant:
        raise PermissionDenied('Not allowed.')

    current_round = match.current_round
    if current_round.status != Round.Status.RUNNING or not current_round.started_at:
        return match

    duration_seconds = int(getattr(settings, 'MATCH_ROUND_DURATION_SECONDS', 300))
    deadline = current_round.started_at + timedelta(seconds=duration_seconds)
    if timezone.now() < deadline:
        return match

    return _advance_round_locked(match)


@transaction.atomic
def advance_round(user, match):
    match = Match.objects.select_for_update().select_related('room', 'current_round').get(pk=match.pk)
    ensure_match_admin(user, match)
    return _advance_round_locked(match)


@transaction.atomic
def stop_match(user, match):
    match = Match.objects.select_for_update().select_related('room').get(pk=match.pk)
    ensure_match_admin(user, match)
    if match.status != Match.Status.RUNNING:
        raise ValidationError('Match is not running.')

    winner = _select_winner(match)
    return _finish_match(match, winner, auto_select_winner=False)


@transaction.atomic
def restart_current_round(user, match):
    match = Match.objects.select_for_update().select_related('room', 'current_round').get(pk=match.pk)
    ensure_match_admin(user, match)
    if match.status != Match.Status.RUNNING or not match.current_round:
        raise ValidationError('Match is not running.')

    round_obj = match.current_round
    round_obj.status = Round.Status.RUNNING
    round_obj.started_at = timezone.now()
    round_obj.ended_at = None
    round_obj.save(update_fields=['status', 'started_at', 'ended_at'])

    # Reset non-eliminated round states back to active for a clean restart.
    RoundParticipant.objects.filter(round=round_obj).exclude(status=RoundParticipant.Status.ELIMINATED).update(status=RoundParticipant.Status.ACTIVE)

    round_duration_seconds = int(getattr(settings, 'MATCH_ROUND_DURATION_SECONDS', 300))
    broadcast_room_event(
        match.room_id,
        'round_started',
        {
            'match_id': match.id,
            'round_id': round_obj.id,
            'round_number': round_obj.number,
            'started_at': round_obj.started_at,
            'round_duration_seconds': round_duration_seconds,
        },
    )
    broadcast_leaderboard(match)
    return match


@transaction.atomic
def auto_advance_if_round_reviewed(user, match):
    match = Match.objects.select_for_update().select_related('room', 'current_round').get(pk=match.pk)
    ensure_match_admin(user, match)
    if match.status != Match.Status.RUNNING or not match.current_round:
        return match

    pending_exists = Submission.objects.filter(
        match=match,
        round=match.current_round,
        manual_decision=Submission.ManualDecision.NONE,
    ).exists()
    if pending_exists:
        return match
    if not _all_active_participants_resolved_for_round(match, match.current_round):
        return match

    return _advance_round_locked(match)


@transaction.atomic
def pass_player_to_next_round(admin_user, match, target_user):
    match = Match.objects.select_for_update().select_related('room', 'current_round').get(pk=match.pk)
    ensure_match_admin(admin_user, match)
    if match.status != Match.Status.RUNNING or not match.current_round:
        raise ValidationError('Match is not running.')

    try:
        participant = MatchParticipant.objects.select_for_update().get(match=match, user=target_user)
    except MatchParticipant.DoesNotExist as exc:
        raise ValidationError('Player is not a participant of this match.') from exc
    if participant.status != MatchParticipant.Status.ACTIVE:
        raise ValidationError('Only active players can be passed to the next round.')

    round_state, _ = RoundParticipant.objects.select_for_update().get_or_create(
        round=match.current_round,
        participant=participant,
    )
    should_advance = round_state.status not in [
        RoundParticipant.Status.SOLVED,
        RoundParticipant.Status.PASSED,
    ]
    if should_advance:
        participant.solved_rounds += 1
        participant.save(update_fields=['solved_rounds'])

    round_state.status = RoundParticipant.Status.PASSED
    round_state.save(update_fields=['status'])
    sync_match_leaderboard(match)
    if should_advance:
        broadcast_room_event(
            match.room_id,
            'player_advanced',
            {
                'match_id': match.id,
                'round_id': match.current_round_id,
                'round_number': match.current_round.number,
                'user_id': participant.user_id,
                'username': participant.user.get_username(),
                'round_level': min(participant.solved_rounds + 1, 5),
                'solved_count': participant.solved_rounds,
                'points': participant.score,
            },
        )
    broadcast_leaderboard(match)
    if _all_active_participants_resolved_for_round(match, match.current_round):
        _advance_round_locked(match)
        participant.refresh_from_db()
    return participant


@transaction.atomic
def eliminate_player(admin_user, match, target_user):
    match = Match.objects.select_for_update().select_related('room', 'current_round').get(pk=match.pk)
    ensure_match_admin(admin_user, match)
    try:
        participant = MatchParticipant.objects.select_for_update().get(match=match, user=target_user)
    except MatchParticipant.DoesNotExist as exc:
        raise ValidationError('Player is not a participant of this match.') from exc

    participant.status = MatchParticipant.Status.ELIMINATED
    participant.eliminated_at = timezone.now()
    participant.save(update_fields=['status', 'eliminated_at'])

    if match.current_round:
        round_state, _ = RoundParticipant.objects.select_for_update().get_or_create(
            round=match.current_round,
            participant=participant,
        )
        round_state.status = RoundParticipant.Status.ELIMINATED
        round_state.save(update_fields=['status'])

    sync_match_leaderboard(match)
    broadcast_room_event(
        match.room_id,
        'player_eliminated',
        {
            'match_id': match.id,
            'user_id': target_user.id,
            'username': target_user.get_username(),
            'round_id': match.current_round_id,
            'round_level': min(participant.solved_rounds + 1, 5),
        },
    )
    broadcast_leaderboard(match)

    remaining = list(MatchParticipant.objects.filter(match=match, status=MatchParticipant.Status.ACTIVE))
    if match.status == Match.Status.RUNNING and len(remaining) <= 1:
        winner = remaining[0].user if remaining else None
        _finish_match(match, winner)
    return participant
