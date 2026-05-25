import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer


logger = logging.getLogger(__name__)


def room_group_name(room_id):
    return f'room_{room_id}'


def broadcast_room_event(room_id, event, payload=None):
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return

    try:
        async_to_sync(channel_layer.group_send)(
            room_group_name(room_id),
            {
                'type': 'room.event',
                'event': event,
                'payload': payload or {},
            },
        )
    except Exception:
        logger.exception('Failed to broadcast realtime event %s for room %s', event, room_id)
