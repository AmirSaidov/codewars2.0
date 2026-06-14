from rest_framework import serializers

from apps.accounts.serializers import UserSerializer
from apps.coding_tasks.serializers import CodingTaskSerializer

from .models import Match, MatchParticipant, Round, RoundParticipant


class RoundParticipantSerializer(serializers.ModelSerializer):
    user = serializers.SerializerMethodField()

    class Meta:
        model = RoundParticipant
        fields = ['id', 'user', 'status', 'solved_at', 'time_spent']
        read_only_fields = fields

    def get_user(self, obj):
        return UserSerializer(obj.participant.user).data


class RoundSerializer(serializers.ModelSerializer):
    task = CodingTaskSerializer(read_only=True)
    players = RoundParticipantSerializer(source='round_participants', many=True, read_only=True)

    class Meta:
        model = Round
        fields = ['id', 'match', 'number', 'status', 'task', 'players', 'started_at', 'ended_at']
        read_only_fields = fields


class MatchParticipantSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)

    class Meta:
        model = MatchParticipant
        fields = [
            'id',
            'user',
            'status',
            'score',
            'solved_rounds',
            'total_solution_time',
            'joined_at',
            'eliminated_at',
        ]
        read_only_fields = fields


class MatchSerializer(serializers.ModelSerializer):
    current_round = RoundSerializer(read_only=True)
    rounds = RoundSerializer(many=True, read_only=True)
    participants = MatchParticipantSerializer(many=True, read_only=True)
    winner = UserSerializer(read_only=True)

    class Meta:
        model = Match
        fields = [
            'id',
            'room',
            'status',
            'current_round',
            'rounds',
            'participants',
            'winner',
            'created_at',
            'started_at',
            'finished_at',
        ]
        read_only_fields = fields


class StartMatchSerializer(serializers.Serializer):
    task_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        required=False,
        allow_empty=False,
    )
    round_count = serializers.IntegerField(required=False, min_value=1, max_value=10)


class PlayerActionSerializer(serializers.Serializer):
    user_id = serializers.IntegerField(min_value=1)
