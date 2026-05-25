from rest_framework import serializers

from apps.accounts.serializers import UserSerializer

from .models import LeaderboardEntry


class LeaderboardEntrySerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)

    class Meta:
        model = LeaderboardEntry
        fields = [
            'id',
            'room',
            'match',
            'user',
            'points',
            'solved_count',
            'total_solution_time',
            'player_status',
            'eliminated',
            'last_submission_status',
            'updated_at',
        ]
        read_only_fields = fields
