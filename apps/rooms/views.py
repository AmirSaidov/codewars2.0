from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.leaderboard.serializers import LeaderboardEntrySerializer
from apps.leaderboard.services import get_room_leaderboard
from apps.matches.serializers import MatchSerializer, StartMatchSerializer
from apps.matches.services import start_match

from .models import Room
from .serializers import JoinRoomSerializer, ReadySerializer, RoomSerializer
from .services import create_room, join_room, leave_room, set_ready


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
        match = start_match(request.user, room, serializer.validated_data.get('task_ids'))
        return Response(MatchSerializer(match, context=self.get_serializer_context()).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get'])
    def leaderboard(self, request, pk=None):
        room = self.get_object()
        entries = get_room_leaderboard(room)
        return Response(LeaderboardEntrySerializer(entries, many=True).data)
