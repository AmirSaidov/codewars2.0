from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.coding_tasks.models import CodingTask
from apps.leaderboard.services import broadcast_leaderboard, sync_match_leaderboard
from apps.realtime.services import broadcast_room_event
from apps.rooms.models import Room, RoomMembership
from apps.rooms.services import ensure_room_admin

from .models import Match, MatchParticipant, Round, RoundParticipant


def ensure_match_admin(user, match):
    if match.room.creator_id != user.id:
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


def _create_round_participants(round_obj, participants):
    RoundParticipant.objects.bulk_create(
        [
            RoundParticipant(round=round_obj, participant=participant)
            for participant in participants
        ],
        ignore_conflicts=True,
    )


@transaction.atomic
def start_match(user, room, task_ids=None):
    room = Room.objects.select_for_update().get(pk=room.pk)
    ensure_room_admin(user, room)

    if room.status == Room.Status.RUNNING:
        raise ValidationError('Room already has a running match.')

    tasks = _load_tasks(task_ids)
    memberships = list(
        RoomMembership.objects.select_related('user')
        .filter(room=room, status=RoomMembership.Status.ACTIVE)
        .order_by('joined_at')
    )
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
    broadcast_room_event(room.id, 'match_started', {'match_id': match.id, 'room_id': room.id})
    broadcast_room_event(
        room.id,
        'round_started',
        {'match_id': match.id, 'round_id': first_round.id, 'round_number': first_round.number},
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
    if round_state.status != RoundParticipant.Status.SOLVED:
        participant.score += 100
        participant.solved_rounds += 1
        participant.total_solution_time += submission.execution_time
        participant.save(update_fields=['score', 'solved_rounds', 'total_solution_time'])

    round_state.status = RoundParticipant.Status.SOLVED
    round_state.solved_at = timezone.now()
    round_state.time_spent = submission.execution_time
    round_state.save(update_fields=['status', 'solved_at', 'time_spent'])
    sync_match_leaderboard(submission.match)
    return participant


def _finish_match(match, winner=None):
    match.status = Match.Status.FINISHED
    match.finished_at = timezone.now()
    match.winner = winner
    match.save(update_fields=['status', 'finished_at', 'winner'])

    if match.current_round and match.current_round.status != Round.Status.FINISHED:
        match.current_round.status = Round.Status.FINISHED
        match.current_round.ended_at = timezone.now()
        match.current_round.save(update_fields=['status', 'ended_at'])

    if winner:
        MatchParticipant.objects.filter(match=match, user=winner).update(status=MatchParticipant.Status.WINNER)

    match.room.status = Room.Status.FINISHED
    match.room.save(update_fields=['status'])
    sync_match_leaderboard(match)
    broadcast_leaderboard(match)
    broadcast_room_event(
        match.room_id,
        'match_finished',
        {'match_id': match.id, 'winner_id': winner.id if winner else None},
    )
    return match


@transaction.atomic
def advance_round(user, match):
    match = Match.objects.select_for_update().select_related('room', 'current_round').get(pk=match.pk)
    ensure_match_admin(user, match)
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
                {'match_id': match.id, 'user_id': participant.user_id, 'round_id': current_round.id},
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
        return _finish_match(match, winner)

    next_round.status = Round.Status.RUNNING
    next_round.started_at = timezone.now()
    next_round.save(update_fields=['status', 'started_at'])
    _create_round_participants(next_round, remaining)

    match.current_round = next_round
    match.save(update_fields=['current_round'])

    sync_match_leaderboard(match)
    broadcast_room_event(
        match.room_id,
        'round_started',
        {'match_id': match.id, 'round_id': next_round.id, 'round_number': next_round.number},
    )
    broadcast_leaderboard(match)
    return match


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
    round_state.status = RoundParticipant.Status.PASSED
    round_state.save(update_fields=['status'])
    broadcast_leaderboard(match)
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
        {'match_id': match.id, 'user_id': target_user.id},
    )
    broadcast_leaderboard(match)

    remaining = list(MatchParticipant.objects.filter(match=match, status=MatchParticipant.Status.ACTIVE))
    if match.status == Match.Status.RUNNING and len(remaining) <= 1:
        winner = remaining[0].user if remaining else None
        _finish_match(match, winner)
    return participant
