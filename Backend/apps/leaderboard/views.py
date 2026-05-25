from django.shortcuts import get_object_or_404
from rest_framework import permissions
from rest_framework.generics import ListAPIView

from apps.matches.models import Match
from apps.rooms.models import Room

from .serializers import LeaderboardEntrySerializer
from .services import get_match_leaderboard, get_room_leaderboard


class RoomLeaderboardView(ListAPIView):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = LeaderboardEntrySerializer

    def get_queryset(self):
        room = get_object_or_404(Room, pk=self.kwargs['room_id'])
        return get_room_leaderboard(room)


class MatchLeaderboardView(ListAPIView):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = LeaderboardEntrySerializer

    def get_queryset(self):
        match = get_object_or_404(Match, pk=self.kwargs['match_id'])
        return get_match_leaderboard(match)
