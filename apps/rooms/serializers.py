from rest_framework import serializers

from apps.accounts.serializers import UserSerializer

from .models import Room, RoomMembership


class RoomMembershipSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)

    class Meta:
        model = RoomMembership
        fields = ['id', 'user', 'is_ready', 'status', 'joined_at', 'left_at']
        read_only_fields = fields


class RoomSerializer(serializers.ModelSerializer):
    creator = UserSerializer(read_only=True)
    players = serializers.SerializerMethodField()
    player_count = serializers.SerializerMethodField()
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
            'status',
            'players',
            'player_count',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'creator', 'status', 'players', 'player_count', 'created_at', 'updated_at']

    def get_players(self, obj):
        memberships = obj.memberships.select_related('user').filter(status=RoomMembership.Status.ACTIVE)
        return RoomMembershipSerializer(memberships, many=True).data

    def get_player_count(self, obj):
        return obj.memberships.filter(status=RoomMembership.Status.ACTIVE).count()

    def validate_max_players(self, value):
        if value > 10:
            raise serializers.ValidationError('Room max_players cannot be greater than 10.')
        if value < 1:
            raise serializers.ValidationError('Room max_players must be at least 1.')
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
