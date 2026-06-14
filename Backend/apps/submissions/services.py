from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.leaderboard.services import broadcast_leaderboard, sync_match_leaderboard
from apps.matches.models import Match, MatchParticipant, Round
from apps.matches.services import auto_advance_if_round_reviewed, mark_player_solved
from apps.realtime.services import broadcast_room_event

from .models import Submission


def _ensure_submission_admin(user, submission):
    if submission.match.room.creator_id != user.id:
        raise PermissionDenied('Only room admin can moderate submissions.')


def _validate_submission_target(user, match, round_obj):
    if match.status != Match.Status.RUNNING:
        raise ValidationError('Match is not running.')
    if match.current_round_id != round_obj.id:
        raise ValidationError('Submissions are accepted only for the current round.')

    try:
        participant = MatchParticipant.objects.get(match=match, user=user)
    except MatchParticipant.DoesNotExist as exc:
        raise ValidationError('You are not a participant of this match.') from exc

    if participant.status != MatchParticipant.Status.ACTIVE:
        raise ValidationError('Eliminated players cannot submit solutions.')
    return participant


def submit_code(user, *, match_id, round_id=None, code):
    try:
        match = Match.objects.select_related('room', 'current_round__task').get(pk=match_id)
    except Match.DoesNotExist as exc:
        raise ValidationError('Match not found.') from exc

    if match.room.creator_id == user.id:
        raise ValidationError('Room admin cannot submit solutions.')

    if round_id is None:
        round_obj = match.current_round
    else:
        try:
            round_obj = Round.objects.select_related('task').get(pk=round_id)
        except Round.DoesNotExist as exc:
            raise ValidationError('Round not found.') from exc

    if round_obj is None:
        raise ValidationError('Match has no current round.')
    if round_obj.match_id != match.id:
        raise ValidationError('Round does not belong to this match.')

    _validate_submission_target(user, match, round_obj)
    task = round_obj.task

    if Submission.objects.filter(match=match, round=round_obj, user=user).exists():
        raise ValidationError('You can submit only once per task.')

    try:
        submission = Submission.objects.create(
            user=user,
            match=match,
            round=round_obj,
            task=task,
            code=code,
            status=Submission.Status.PENDING,
            execution_time=0,
            test_results=[],
        )
    except IntegrityError as exc:
        raise ValidationError('You can submit only once per task.') from exc

    broadcast_room_event(
        match.room_id,
        'solution_submitted',
        {
            'match_id': match.id,
            'round_id': round_obj.id,
            'submission_id': submission.id,
            'user_id': user.id,
            'status': submission.status,
        },
    )

    return submission


@transaction.atomic
def accept_submission(admin_user, submission):
    submission = Submission.objects.select_for_update().select_related('match__room', 'round', 'user').get(pk=submission.pk)
    _ensure_submission_admin(admin_user, submission)

    submission.status = Submission.Status.ACCEPTED
    submission.manual_decision = Submission.ManualDecision.ACCEPTED
    submission.moderated_by = admin_user
    submission.moderated_at = timezone.now()
    submission.save(update_fields=['status', 'manual_decision', 'moderated_by', 'moderated_at'])

    from apps.matches.services import mark_player_solved

    mark_player_solved(submission)
    broadcast_room_event(
        submission.match.room_id,
        'solution_accepted',
        {
            'match_id': submission.match_id,
            'round_id': submission.round_id,
            'submission_id': submission.id,
            'user_id': submission.user_id,
            'manual': True,
        },
    )
    broadcast_leaderboard(submission.match)
    auto_advance_if_round_reviewed(admin_user, submission.match)
    return submission


@transaction.atomic
def reject_submission(admin_user, submission):
    submission = Submission.objects.select_for_update().select_related('match__room').get(pk=submission.pk)
    _ensure_submission_admin(admin_user, submission)

    submission.status = Submission.Status.WRONG_ANSWER
    submission.manual_decision = Submission.ManualDecision.REJECTED
    submission.moderated_by = admin_user
    submission.moderated_at = timezone.now()
    submission.save(update_fields=['status', 'manual_decision', 'moderated_by', 'moderated_at'])

    sync_match_leaderboard(submission.match)
    broadcast_leaderboard(submission.match)
    auto_advance_if_round_reviewed(admin_user, submission.match)
    return submission
