from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.realtime.services import broadcast_room_event
from apps.matches.models import Match, MatchParticipant
from apps.leaderboard.services import broadcast_leaderboard, sync_match_leaderboard

from .models import Room, RoomMembership


def ensure_room_admin(user, room):
    if room.creator_id != user.id and not user.is_staff:
        raise PermissionDenied('Only room admin can perform this action.')


def get_active_room_for_user(user):
    membership = (
        RoomMembership.objects.select_related('room')
        .filter(user=user, status=RoomMembership.Status.ACTIVE)
        .order_by('-joined_at')
        .first()
    )
    return membership.room if membership else None


@transaction.atomic
def create_room(user, *, name, is_private=False, password='', max_players=10, round_count=3):
    if max_players > 10:
        raise ValidationError({'max_players': 'Room max_players cannot be greater than 10.'})
    if round_count > 10:
        raise ValidationError({'round_count': 'Room round_count cannot be greater than 10.'})
    if round_count < 1:
        raise ValidationError({'round_count': 'Room round_count must be at least 1.'})
    if is_private and not password:
        raise ValidationError({'password': 'Password is required for private rooms.'})

    existing_room = get_active_room_for_user(user)
    if existing_room:
        raise ValidationError(f'You are already in a room (#{existing_room.id}). Leave it before creating another one.')

    room = Room.objects.create(
        name=name,
        creator=user,
        is_private=is_private,
        max_players=max_players,
        round_count=round_count,
    )
    room.set_password(password)
    room.save(update_fields=['password_hash'])
    RoomMembership.objects.create(room=room, user=user)
    return room


@transaction.atomic
def join_room(user, room, password=''):
    room = Room.objects.select_for_update().get(pk=room.pk)
    if room.status != Room.Status.WAITING:
        raise ValidationError('You can join only rooms in waiting status.')
    if not room.check_password(password):
        raise ValidationError({'password': 'Invalid room password.'})

    other_active = (
        RoomMembership.objects.select_for_update()
        .select_related('room')
        .filter(user=user, status=RoomMembership.Status.ACTIVE)
        .exclude(room=room)
        .order_by('-joined_at')
        .first()
    )
    if other_active:
        raise ValidationError(
            f'You are already in room #{other_active.room_id}. Leave it before joining another one.'
        )

    active_count = RoomMembership.objects.filter(
        room=room,
        status=RoomMembership.Status.ACTIVE,
    ).exclude(user_id=room.creator_id).count()

    if user.id != room.creator_id and active_count >= room.max_players:
        raise ValidationError('Room is full.')

    membership, created = RoomMembership.objects.select_for_update().get_or_create(
        room=room,
        user=user,
        defaults={'status': RoomMembership.Status.ACTIVE},
    )
    if not created and membership.status == RoomMembership.Status.ACTIVE:
        return membership

    membership.status = RoomMembership.Status.ACTIVE
    membership.is_ready = False
    membership.joined_at = timezone.now()
    membership.left_at = None
    membership.save(update_fields=['status', 'is_ready', 'joined_at', 'left_at'])

    broadcast_room_event(
        room.id,
        'player_joined',
        {'user_id': user.id, 'username': user.get_username(), 'room_id': room.id},
    )
    return membership


@transaction.atomic
def leave_room(user, room):
    try:
        membership = RoomMembership.objects.select_for_update().get(
            room=room,
            user=user,
            status=RoomMembership.Status.ACTIVE,
        )
    except RoomMembership.DoesNotExist as exc:
        raise ValidationError('You are not an active member of this room.') from exc

    membership.status = RoomMembership.Status.LEFT
    membership.is_ready = False
    membership.left_at = timezone.now()
    membership.save(update_fields=['status', 'is_ready', 'left_at'])

    if room.creator_id == user.id:
        broadcast_room_event(
            room.id,
            'room_disbanded',
            {
                'room_id': room.id,
                'user_id': user.id,
                'username': user.get_username(),
            },
        )
        room.delete()
        return membership

    running_match = room.matches.filter(status=Match.Status.RUNNING).order_by('-created_at').first()
    if running_match:
        MatchParticipant.objects.filter(match=running_match, user=user).update(status=MatchParticipant.Status.LEFT)
        sync_match_leaderboard(running_match)
        broadcast_leaderboard(running_match)

    broadcast_room_event(
        room.id,
        'player_left',
        {'user_id': user.id, 'username': user.get_username(), 'room_id': room.id},
    )

    remaining_active = RoomMembership.objects.filter(room=room, status=RoomMembership.Status.ACTIVE).count()
    if remaining_active == 0:
        # Prevent dashboard from filling up with abandoned rooms.
        # Room has no active members, so it can be safely deleted.
        room.delete()
    return membership


@transaction.atomic
def set_ready(user, room, is_ready):
    try:
        membership = RoomMembership.objects.select_for_update().get(
            room=room,
            user=user,
            status=RoomMembership.Status.ACTIVE,
        )
    except RoomMembership.DoesNotExist as exc:
        raise ValidationError('You are not an active member of this room.') from exc

    membership.is_ready = is_ready
    membership.save(update_fields=['is_ready'])

    broadcast_room_event(
        room.id,
        'player_ready',
        {
            'user_id': user.id,
            'username': user.get_username(),
            'room_id': room.id,
            'is_ready': is_ready,
        },
    )
    return membership


@transaction.atomic
def disband_room(user, room):
    ensure_room_admin(user, room)
    room_id = room.id
    broadcast_room_event(
        room_id,
        'room_disbanded',
        {
            'room_id': room_id,
            'user_id': user.id,
            'username': user.get_username(),
        },
    )
    room.delete()
