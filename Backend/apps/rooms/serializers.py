from rest_framework import serializers
from django.conf import settings

from apps.accounts.serializers import UserSerializer
from apps.matches.models import Match
from .models import RoomSelectedTask
from .models import Room, RoomMembership, RoomChatMessage


class RoomMembershipSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)

    class Meta:
        model = RoomMembership
        fields = ['id', 'user', 'is_ready', 'status', 'joined_at', 'left_at']
        read_only_fields = fields


class RoomChatMessageSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)

    class Meta:
        model = RoomChatMessage
        fields = ['id', 'user', 'message', 'created_at']
        read_only_fields = fields


class RoomSerializer(serializers.ModelSerializer):
    creator = UserSerializer(read_only=True)
    players = serializers.SerializerMethodField()
    player_count = serializers.SerializerMethodField()
    current_match = serializers.SerializerMethodField()
    round_duration_seconds = serializers.SerializerMethodField()
    selected_task_ids = serializers.SerializerMethodField()
    chat_messages = serializers.SerializerMethodField()
    password = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = Room
        fields = [
            'id',
            'name',
            'creator',
            'is_private',
            'password',
            'max_players',
            'round_count',
            'status',
            'players',
            'player_count',
            'current_match',
            'round_duration_seconds',
            'selected_task_ids',
            'chat_messages',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'creator', 'status', 'players', 'player_count', 'created_at', 'updated_at']

    def get_players(self, obj):
        memberships = obj.memberships.select_related('user').filter(status=RoomMembership.Status.ACTIVE)
        return RoomMembershipSerializer(memberships, many=True).data

    def get_player_count(self, obj):
        return obj.memberships.filter(status=RoomMembership.Status.ACTIVE).exclude(user_id=obj.creator_id).count()

    def get_round_duration_seconds(self, obj):
        return int(getattr(settings, 'MATCH_ROUND_DURATION_SECONDS', 300))

    def get_current_match(self, obj):
        match = (
            obj.matches.select_related('current_round')
            .filter(status=Match.Status.RUNNING)
            .order_by('-created_at')
            .first()
        )
        if not match:
            return None
        current_round = match.current_round
        return {
            'id': match.id,
            'status': match.status,
            'started_at': match.started_at,
            'finished_at': match.finished_at,
            'current_round': (
                {
                    'id': current_round.id,
                    'number': current_round.number,
                    'status': current_round.status,
                    'started_at': current_round.started_at,
                    'ended_at': current_round.ended_at,
                }
                if current_round
                else None
            ),
        }

    def get_selected_task_ids(self, obj):
        return list(
            RoomSelectedTask.objects.filter(room=obj)
            .order_by('position', 'created_at')
            .values_list('task_id', flat=True)
        )

    def get_chat_messages(self, obj):
        messages = list(obj.chat_messages.select_related('user').order_by('-created_at', '-id')[:50])
        serialized = RoomChatMessageSerializer(list(reversed(messages)), many=True)
        return serialized.data

    def validate_max_players(self, value):
        if value > 10:
            raise serializers.ValidationError('Room max_players cannot be greater than 10.')
        if value < 1:
            raise serializers.ValidationError('Room max_players must be at least 1.')
        return value

    def validate_round_count(self, value):
        if value > 10:
            raise serializers.ValidationError('Room round_count cannot be greater than 10.')
        if value < 1:
            raise serializers.ValidationError('Room round_count must be at least 1.')
        return value

    def validate(self, attrs):
        is_private = attrs.get('is_private', False)
        password = attrs.get('password', '')
        if is_private and not password:
            raise serializers.ValidationError({'password': 'Password is required for private rooms.'})
        return attrs


class JoinRoomSerializer(serializers.Serializer):
    password = serializers.CharField(required=False, allow_blank=True)


class ReadySerializer(serializers.Serializer):
    is_ready = serializers.BooleanField()


class AdminPlayerSerializer(serializers.Serializer):
    player_id = serializers.IntegerField(min_value=1)


class AdminTaskSerializer(serializers.Serializer):
    task_id = serializers.IntegerField(min_value=1)


class AdminRoomConfigSerializer(serializers.Serializer):
    round_count = serializers.IntegerField(min_value=1, max_value=10)
