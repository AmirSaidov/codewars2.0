import json

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer

from apps.rooms.models import Room, RoomChatMessage, RoomMembership
from apps.rooms.serializers import RoomChatMessageSerializer

from .services import room_group_name


class RoomConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.room_id = self.scope['url_route']['kwargs']['room_id']
        self.group_name = room_group_name(self.room_id)

        if not self.scope.get('user') or not self.scope['user'].is_authenticated:
            await self.close(code=4401)
            return

        if not await self._can_access_room():
            await self.close(code=4403)
            return

        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        if hasattr(self, 'group_name'):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self, text_data=None, bytes_data=None):
        if not text_data:
            return
        try:
            data = json.loads(text_data)
        except json.JSONDecodeError:
            return

        event = data.get('event') or data.get('type')
        payload = data.get('payload') or {}
        if event != 'chat_message':
            return

        message_text = str(payload.get('message') or '').strip()
        if not message_text:
            return

        message = await self._save_chat_message(message_text)
        await self.channel_layer.group_send(
            self.group_name,
            {
                'type': 'room.event',
                'event': 'chat_message',
                'payload': message,
            },
        )

    async def room_event(self, event):
        await self.send(
            text_data=json.dumps(
                {
                    'event': event['event'],
                    'payload': event.get('payload', {}),
                }
            )
        )

    @database_sync_to_async
    def _can_access_room(self):
        room = Room.objects.filter(pk=self.room_id).select_related('creator').first()
        if not room:
            return False
        user = self.scope['user']
        if room.creator_id == user.id or user.is_staff:
            return True
        return RoomMembership.objects.filter(room=room, user=user, status=RoomMembership.Status.ACTIVE).exists()

    @database_sync_to_async
    def _save_chat_message(self, message_text):
        room = Room.objects.select_related('creator').get(pk=self.room_id)
        user = self.scope['user']
        chat = RoomChatMessage.objects.create(room=room, user=user, message=message_text)
        return RoomChatMessageSerializer(chat).data
