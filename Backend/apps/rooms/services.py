from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.realtime.services import broadcast_room_event

from .models import Room, RoomMembership


def ensure_room_admin(user, room):
    if room.creator_id != user.id:
        raise PermissionDenied('Only room admin can perform this action.')


@transaction.atomic
def create_room(user, *, name, is_private=False, password='', max_players=10):
    if max_players > 10:
        raise ValidationError({'max_players': 'Room max_players cannot be greater than 10.'})
    if is_private and not password:
        raise ValidationError({'password': 'Password is required for private rooms.'})

    room = Room.objects.create(
        name=name,
        creator=user,
        is_private=is_private,
        max_players=max_players,
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

    membership, created = RoomMembership.objects.select_for_update().get_or_create(
        room=room,
        user=user,
        defaults={'status': RoomMembership.Status.ACTIVE},
    )
    if not created and membership.status == RoomMembership.Status.ACTIVE:
        return membership

    active_count = RoomMembership.objects.filter(room=room, status=RoomMembership.Status.ACTIVE).count()
    if (created and active_count > room.max_players) or (not created and active_count >= room.max_players):
        raise ValidationError('Room is full.')

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

    broadcast_room_event(
        room.id,
        'player_left',
        {'user_id': user.id, 'username': user.get_username(), 'room_id': room.id},
    )
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
