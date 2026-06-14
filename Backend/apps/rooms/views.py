from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from django.utils import timezone
from django.shortcuts import get_object_or_404
from django.db.models import Q

from apps.leaderboard.serializers import LeaderboardEntrySerializer
from apps.leaderboard.services import get_room_leaderboard
from apps.matches.serializers import MatchSerializer, StartMatchSerializer
from apps.matches.services import restart_current_round, start_match, stop_match, pass_player_to_next_round
from apps.matches.models import Match, MatchParticipant
from apps.coding_tasks.models import CodingTask
from apps.submissions.models import Submission
from apps.submissions.serializers import SubmissionSerializer
from apps.submissions.services import accept_submission, reject_submission
from django.contrib.auth import get_user_model

from .models import Room
from .serializers import (
    AdminPlayerSerializer,
    AdminRoomConfigSerializer,
    AdminTaskSerializer,
    JoinRoomSerializer,
    ReadySerializer,
    RoomChatMessageSerializer,
    RoomSerializer,
)
from .services import create_room, disband_room, get_active_room_for_user, join_room, leave_room, set_ready, ensure_room_admin
from .models import RoomSelectedTask


class RoomViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = RoomSerializer
    http_method_names = ['get', 'post', 'head', 'options']

    def get_queryset(self):
        return Room.objects.select_related('creator').prefetch_related('memberships__user')

    def _get_latest_match(self, room):
        return (
            room.matches.select_related('winner', 'current_round')
            .prefetch_related('participants__user')
            .order_by('-created_at')
            .first()
        )

    def _serialize_tournament_players(self, match):
        if not match:
            return []

        participants = list(
            match.participants.select_related('user').exclude(user_id=match.room.creator_id)
        )
        players = []
        for participant in participants:
            is_winner = participant.status == MatchParticipant.Status.WINNER
            is_eliminated = participant.status in [MatchParticipant.Status.ELIMINATED, MatchParticipant.Status.LEFT]
            if is_winner:
                status_value = 'winner'
            elif is_eliminated:
                status_value = 'eliminated'
            elif participant.solved_rounds > 0:
                status_value = 'advanced'
            elif match.status == Match.Status.WAITING:
                status_value = 'waiting'
            else:
                status_value = 'active'

            round_level = min(max(participant.solved_rounds + 1, 1), 5)
            if is_winner:
                round_level = 5

            players.append(
                {
                    'user_id': participant.user_id,
                    'username': participant.user.get_username(),
                    'status': status_value,
                    'round_level': round_level,
                    'is_winner': is_winner,
                    'is_eliminated': is_eliminated,
                    'points': participant.score,
                    'solved_count': participant.solved_rounds,
                    'total_solution_time': participant.total_solution_time,
                }
            )

        players.sort(
            key=lambda player: (
                not player['is_winner'],
                player['is_eliminated'],
                -(player['points'] or 0),
                player['total_solution_time'] or 0,
                player['username'].lower(),
            )
        )
        return players

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        room = create_room(request.user, **serializer.validated_data)
        return Response(RoomSerializer(room, context=self.get_serializer_context()).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'])
    def join(self, request, pk=None):
        room = self.get_object()
        serializer = JoinRoomSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        join_room(request.user, room, serializer.validated_data.get('password', ''))
        room.refresh_from_db()
        return Response(RoomSerializer(room, context=self.get_serializer_context()).data)

    @action(detail=True, methods=['post'])
    def leave(self, request, pk=None):
        room = self.get_object()
        leave_room(request.user, room)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'], url_path='disband')
    def disband(self, request, pk=None):
        room = self.get_object()
        disband_room(request.user, room)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'])
    def ready(self, request, pk=None):
        room = self.get_object()
        set_ready(request.user, room, True)
        room.refresh_from_db()
        return Response(RoomSerializer(room, context=self.get_serializer_context()).data)

    @action(detail=True, methods=['post'])
    def unready(self, request, pk=None):
        room = self.get_object()
        set_ready(request.user, room, False)
        room.refresh_from_db()
        return Response(RoomSerializer(room, context=self.get_serializer_context()).data)

    @action(detail=True, methods=['post'], url_path='start-match')
    def start_match(self, request, pk=None):
        room = self.get_object()
        serializer = StartMatchSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        task_ids = serializer.validated_data.get('task_ids')
        round_count = serializer.validated_data.get('round_count') or room.round_count
        if not task_ids:
            task_ids = list(room.selected_tasks.order_by('position', 'created_at').values_list('task_id', flat=True))
        match = start_match(request.user, room, task_ids or None, round_count=round_count)
        return Response(MatchSerializer(match, context=self.get_serializer_context()).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], url_path='admin/start')
    def admin_start(self, request, pk=None):
        room = self.get_object()
        serializer = StartMatchSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        task_ids = serializer.validated_data.get('task_ids')
        round_count = serializer.validated_data.get('round_count') or room.round_count
        if not task_ids:
            task_ids = list(room.selected_tasks.order_by('position', 'created_at').values_list('task_id', flat=True))
        match = start_match(request.user, room, task_ids or None, round_count=round_count)
        return Response({'success': True, 'match_id': match.id}, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get'])
    def leaderboard(self, request, pk=None):
        room = self.get_object()
        entries = get_room_leaderboard(room)
        return Response(LeaderboardEntrySerializer(entries, many=True).data)

    @action(detail=True, methods=['get'])
    def messages(self, request, pk=None):
        room = self.get_object()
        messages = list(room.chat_messages.select_related('user').order_by('-created_at', '-id')[:50])
        serializer = RoomChatMessageSerializer(list(reversed(messages)), many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['get'])
    def tournament(self, request, pk=None):
        room = self.get_object()
        match = self._get_latest_match(room)
        current_round = 1
        status_value = room.status

        if match:
            if match.current_round_id:
                current_round = match.current_round.number
            elif match.winner_id:
                current_round = room.round_count
            status_value = room.status if room.status != Room.Status.WAITING else match.status

        return Response(
            {
                'room_id': room.id,
                'status': status_value,
                'current_round': current_round,
                'players': self._serialize_tournament_players(match),
            }
        )

    @action(detail=False, methods=['get'], url_path='my-active')
    def my_active(self, request):
        room = get_active_room_for_user(request.user)
        return Response(RoomSerializer(room, context=self.get_serializer_context()).data if room else None)

    # -------- Admin endpoints (creator/staff) --------

    @action(detail=True, methods=['post'], url_path='admin/stop')
    def admin_stop(self, request, pk=None):
        room = self.get_object()
        match = room.matches.filter(status='running').order_by('-created_at').first()
        if not match:
            return Response({'success': False, 'detail': 'No running match.'}, status=status.HTTP_400_BAD_REQUEST)
        stop_match(request.user, match)
        return Response({'success': True})

    @action(detail=True, methods=['post'], url_path='admin/restart_round')
    def admin_restart_round(self, request, pk=None):
        room = self.get_object()
        match = room.matches.filter(status='running').order_by('-created_at').first()
        if not match:
            return Response({'success': False, 'detail': 'No running match.'}, status=status.HTTP_400_BAD_REQUEST)
        restart_current_round(request.user, match)
        return Response({'success': True})

    @action(detail=True, methods=['post'], url_path='admin/kick')
    def admin_kick(self, request, pk=None):
        room = self.get_object()
        ensure_room_admin(request.user, room)
        serializer = AdminPlayerSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        User = get_user_model()
        target_user = get_object_or_404(User, pk=serializer.validated_data['player_id'])
        leave_room(target_user, room)
        return Response({'success': True})

    @action(detail=True, methods=['post'], url_path='admin/advance')
    def admin_advance(self, request, pk=None):
        room = self.get_object()
        match = room.matches.filter(status='running').order_by('-created_at').first()
        if not match:
            return Response({'success': False, 'detail': 'No running match.'}, status=status.HTTP_400_BAD_REQUEST)
        serializer = AdminPlayerSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        User = get_user_model()
        target_user = get_object_or_404(User, pk=serializer.validated_data['player_id'])
        pass_player_to_next_round(request.user, match, target_user)
        return Response({'success': True})

    @action(detail=True, methods=['get'], url_path='admin/submissions')
    def admin_submissions(self, request, pk=None):
        room = self.get_object()
        ensure_room_admin(request.user, room)
        submissions = Submission.objects.select_related(
            'user',
            'match__room',
            'round',
            'task',
            'moderated_by',
        ).filter(match__room=room)

        match_filter = str(request.query_params.get('match') or '').strip()
        if match_filter.isdigit():
            submissions = submissions.filter(match_id=int(match_filter))
        else:
            running_match = room.matches.filter(status=Match.Status.RUNNING).order_by('-created_at').first()
            if running_match:
                submissions = submissions.filter(match=running_match)

        round_filter = str(request.query_params.get('round') or '').strip()
        if round_filter.isdigit():
            round_number_or_id = int(round_filter)
            submissions = submissions.filter(Q(round_id=round_number_or_id) | Q(round__number=round_number_or_id))

        serializer = SubmissionSerializer(submissions, many=True, context=self.get_serializer_context())
        return Response(serializer.data)

    @action(detail=True, methods=['post'], url_path=r'admin/submissions/(?P<submission_id>\d+)/accept')
    def admin_accept_submission(self, request, pk=None, submission_id=None):
        room = self.get_object()
        ensure_room_admin(request.user, room)
        submission = get_object_or_404(Submission, pk=submission_id, match__room=room)
        updated = accept_submission(request.user, submission)
        return Response(
            {
                'success': True,
                'submission': SubmissionSerializer(updated, context=self.get_serializer_context()).data,
            }
        )

    @action(detail=True, methods=['post'], url_path=r'admin/submissions/(?P<submission_id>\d+)/reject')
    def admin_reject_submission(self, request, pk=None, submission_id=None):
        room = self.get_object()
        ensure_room_admin(request.user, room)
        submission = get_object_or_404(Submission, pk=submission_id, match__room=room)
        updated = reject_submission(request.user, submission)
        return Response(
            {
                'success': True,
                'submission': SubmissionSerializer(updated, context=self.get_serializer_context()).data,
            }
        )

    @action(detail=True, methods=['post'], url_path='admin/task')
    def admin_task(self, request, pk=None):
        room = self.get_object()
        ensure_room_admin(request.user, room)
        serializer = AdminTaskSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        task = get_object_or_404(CodingTask, pk=serializer.validated_data['task_id'])

        # toggle selection
        existing = RoomSelectedTask.objects.filter(room=room, task=task).first()
        if existing:
            existing.delete()
        else:
            position = RoomSelectedTask.objects.filter(room=room).count()
            RoomSelectedTask.objects.create(room=room, task=task, selected_by=request.user, position=position)
        selected_ids = list(RoomSelectedTask.objects.filter(room=room).order_by('position', 'created_at').values_list('task_id', flat=True))
        return Response({'success': True, 'task_ids': selected_ids})

    @action(detail=True, methods=['post'], url_path='admin/config')
    def admin_config(self, request, pk=None):
        room = self.get_object()
        ensure_room_admin(request.user, room)
        if room.status != Room.Status.WAITING:
            return Response({'success': False, 'detail': 'Room settings can only be changed before the match starts.'}, status=status.HTTP_400_BAD_REQUEST)

        serializer = AdminRoomConfigSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        room.round_count = serializer.validated_data['round_count']
        room.save(update_fields=['round_count'])
        room.refresh_from_db()
        return Response(RoomSerializer(room, context=self.get_serializer_context()).data)

    @action(detail=True, methods=['get'])
    def result(self, request, pk=None):
        room = self.get_object()
        match = room.matches.select_related('winner').prefetch_related('participants__user').filter(status='finished').order_by('-finished_at', '-created_at').first()
        if not match:
            return Response(None)

        duration_seconds = 0
        if match.started_at and match.finished_at:
            duration_seconds = int((match.finished_at - match.started_at).total_seconds())

        participants = list(match.participants.select_related('user').exclude(user_id=room.creator_id))
        ranked_participants = sorted(
            participants,
            key=lambda participant: (
                participant.status == MatchParticipant.Status.LEFT,
                -participant.solved_rounds,
                -participant.score,
                participant.total_solution_time,
                participant.joined_at,
                participant.id,
            ),
        )

        participant_by_user_id = {participant.user_id: participant for participant in participants}
        winner = match.winner if match.winner_id in participant_by_user_id else None

        if winner is None and ranked_participants:
            leader = ranked_participants[0]
            if leader.solved_rounds > 0 or leader.score > 0:
                winner = leader.user

        winner_id = winner.id if winner else None
        final_participants = sorted(
            participants,
            key=lambda participant: (
                participant.user_id != winner_id if winner_id is not None else True,
                participant.status in [MatchParticipant.Status.ELIMINATED, MatchParticipant.Status.LEFT],
                -participant.solved_rounds,
                -participant.score,
                participant.total_solution_time,
                participant.joined_at,
                participant.id,
            ),
        )

        players = []
        for idx, participant in enumerate(final_participants, start=1):
            is_winner = winner_id is not None and participant.user_id == winner_id
            status_value = MatchParticipant.Status.WINNER if is_winner else participant.status
            is_eliminated = (
                not is_winner
                and status_value in [MatchParticipant.Status.ELIMINATED, MatchParticipant.Status.LEFT]
            )
            players.append(
                {
                    'id': participant.user_id,
                    'username': participant.user.get_username(),
                    'rank': idx,
                    'final_rank': idx,
                    'rounds_solved': participant.solved_rounds,
                    'solved_rounds': participant.solved_rounds,
                    'solved_count': participant.solved_rounds,
                    'total_time': participant.total_solution_time,
                    'total_solution_time': participant.total_solution_time,
                    'points': participant.score,
                    'score': participant.score,
                    'status': status_value,
                    'is_winner': is_winner,
                    'is_eliminated': is_eliminated,
                }
            )

        winner_payload = None
        if winner:
            winner_payload = {
                'id': winner.id,
                'username': winner.get_username(),
            }

        return Response(
            {
                'room_id': room.id,
                'winner': winner_payload,
                'players': players,
                'standings': players,
                'players_count': len(players),
                'duration': duration_seconds,
                'duration_seconds': duration_seconds,
                'finished_at': match.finished_at.isoformat() if match.finished_at else timezone.now().isoformat(),
            }
        )
