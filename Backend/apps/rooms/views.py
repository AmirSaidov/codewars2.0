from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from django.utils import timezone
from django.shortcuts import get_object_or_404

from apps.leaderboard.serializers import LeaderboardEntrySerializer
from apps.leaderboard.services import get_room_leaderboard
from apps.matches.serializers import MatchSerializer, StartMatchSerializer
from apps.matches.services import restart_current_round, start_match, stop_match, pass_player_to_next_round
from apps.matches.models import MatchParticipant
from apps.coding_tasks.models import CodingTask
from django.contrib.auth import get_user_model

from .models import Room
from .serializers import AdminPlayerSerializer, AdminRoomConfigSerializer, AdminTaskSerializer, JoinRoomSerializer, ReadySerializer, RoomSerializer
from .services import create_room, disband_room, get_active_room_for_user, join_room, leave_room, set_ready, ensure_room_admin
from .models import RoomSelectedTask


class RoomViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = RoomSerializer
    http_method_names = ['get', 'post', 'head', 'options']

    def get_queryset(self):
        return Room.objects.select_related('creator').prefetch_related('memberships__user')

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

    @action(detail=True, methods=['get'])
    def leaderboard(self, request, pk=None):
        room = self.get_object()
        entries = get_room_leaderboard(room)
        return Response(LeaderboardEntrySerializer(entries, many=True).data)

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
        participants.sort(key=lambda p: (-p.score, p.total_solution_time, p.joined_at))

        players = []
        for idx, participant in enumerate(participants, start=1):
            players.append(
                {
                    'id': participant.user_id,
                    'username': participant.user.get_username(),
                    'final_rank': idx,
                    'solved_rounds': participant.solved_rounds,
                    'is_eliminated': participant.status in [MatchParticipant.Status.ELIMINATED, MatchParticipant.Status.LEFT],
                }
            )

        winner = match.winner
        return Response(
            {
                'room_id': room.id,
                'winner': {'id': winner.id, 'username': winner.get_username()} if winner else None,
                'players': players,
                'duration_seconds': duration_seconds,
                'finished_at': match.finished_at.isoformat() if match.finished_at else timezone.now().isoformat(),
            }
        )
