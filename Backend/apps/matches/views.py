from django.contrib.auth import get_user_model
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import permissions, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.leaderboard.serializers import LeaderboardEntrySerializer
from apps.leaderboard.services import get_match_leaderboard

from .models import Match
from .serializers import MatchSerializer, PlayerActionSerializer, RoundSerializer
from .services import advance_round, eliminate_player, maybe_auto_advance_round, pass_player_to_next_round


User = get_user_model()


class MatchViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = MatchSerializer

    def get_queryset(self):
        user = self.request.user
        return (
            Match.objects.select_related('room', 'winner', 'current_round__task')
            .prefetch_related('rounds__task', 'rounds__round_participants__participant__user', 'participants__user')
            .filter(Q(room__creator=user) | Q(participants__user=user))
            .distinct()
        )

    @action(detail=True, methods=['get'], url_path='current-round')
    def current_round(self, request, pk=None):
        match = self.get_object()
        return Response(RoundSerializer(match.current_round).data if match.current_round else None)

    @action(detail=True, methods=['post'], url_path='next-round')
    def next_round(self, request, pk=None):
        match = advance_round(request.user, self.get_object())
        return Response(MatchSerializer(match, context=self.get_serializer_context()).data)

    @action(detail=True, methods=['post'], url_path='tick')
    def tick(self, request, pk=None):
        match = maybe_auto_advance_round(request.user, self.get_object())
        return Response(MatchSerializer(match, context=self.get_serializer_context()).data)

    @action(detail=True, methods=['post'], url_path='pass-player')
    def pass_player(self, request, pk=None):
        serializer = PlayerActionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        target_user = get_object_or_404(User, pk=serializer.validated_data['user_id'])
        participant = pass_player_to_next_round(request.user, self.get_object(), target_user)
        return Response({'user_id': participant.user_id, 'status': participant.status})

    @action(detail=True, methods=['post'], url_path='eliminate-player')
    def eliminate_player(self, request, pk=None):
        serializer = PlayerActionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        target_user = get_object_or_404(User, pk=serializer.validated_data['user_id'])
        participant = eliminate_player(request.user, self.get_object(), target_user)
        return Response({'user_id': participant.user_id, 'status': participant.status})

    @action(detail=True, methods=['get'])
    def leaderboard(self, request, pk=None):
        entries = get_match_leaderboard(self.get_object())
        return Response(LeaderboardEntrySerializer(entries, many=True).data)
