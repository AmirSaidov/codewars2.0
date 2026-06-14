from apps.realtime.services import broadcast_room_event
from apps.submissions.models import Submission

from .models import LeaderboardEntry


def sync_match_leaderboard(match):
    entries = []
    LeaderboardEntry.objects.filter(match=match, user_id=match.room.creator_id).delete()
    for participant in match.participants.select_related('user').exclude(user_id=match.room.creator_id):
        last_submission = (
            Submission.objects.filter(match=match, user=participant.user)
            .order_by('-submitted_at')
            .first()
        )
        entry, _ = LeaderboardEntry.objects.update_or_create(
            match=match,
            user=participant.user,
            defaults={
                'room': match.room,
                'points': participant.score,
                'solved_count': participant.solved_rounds,
                'total_solution_time': participant.total_solution_time,
                'player_status': participant.status,
                'eliminated': participant.status in [participant.Status.ELIMINATED, participant.Status.LEFT],
                'last_submission_status': last_submission.status if last_submission else '',
            },
        )
        entries.append(entry)
    return entries


def get_match_leaderboard(match):
    sync_match_leaderboard(match)
    return LeaderboardEntry.objects.select_related('user', 'room', 'match').filter(match=match).exclude(user_id=match.room.creator_id)


def get_room_leaderboard(room):
    latest_match = room.matches.order_by('-created_at').first()
    if latest_match is None:
        return LeaderboardEntry.objects.none()
    return get_match_leaderboard(latest_match)


def broadcast_leaderboard(match):
    entries = get_match_leaderboard(match)
    payload = [
        {
            'user_id': entry.user_id,
            'username': entry.user.get_username(),
            'points': entry.points,
            'solved_count': entry.solved_count,
            'total_solution_time': entry.total_solution_time,
            'player_status': entry.player_status,
            'eliminated': entry.eliminated,
            'last_submission_status': entry.last_submission_status,
        }
        for entry in entries
    ]
    broadcast_room_event(match.room_id, 'leaderboard_updated', {'match_id': match.id, 'entries': payload})
    return entries
