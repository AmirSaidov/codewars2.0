import json

from channels.generic.websocket import AsyncWebsocketConsumer

from .services import room_group_name


class RoomConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.room_id = self.scope['url_route']['kwargs']['room_id']
        self.group_name = room_group_name(self.room_id)

        if not self.scope.get('user') or not self.scope['user'].is_authenticated:
            await self.close(code=4401)
            return

        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        if hasattr(self, 'group_name'):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self, text_data=None, bytes_data=None):
        return

    async def room_event(self, event):
        await self.send(
            text_data=json.dumps(
                {
                    'event': event['event'],
                    'payload': event.get('payload', {}),
                }
            )
        )
