from asgiref.sync import async_to_sync
from channels.testing import WebsocketCommunicator
from django.contrib.auth import get_user_model
from django.test import TransactionTestCase
from rest_framework_simplejwt.tokens import RefreshToken

from apps.rooms.services import create_room, join_room
from code_zone.asgi import application


User = get_user_model()


class RoomWebSocketTests(TransactionTestCase):
    def setUp(self):
        self.host = User.objects.create_user(username='host', password='pass12345')
        self.player = User.objects.create_user(username='player', password='pass12345')
        self.room = create_room(self.host, name='Realtime room')
        join_room(self.player, self.room)

    def _access_token(self, user):
        return str(RefreshToken.for_user(user).access_token)

    def test_room_websocket_accepts_jwt_member_and_broadcasts_chat(self):
        async def scenario():
            communicator = WebsocketCommunicator(
                application,
                f'/ws/rooms/{self.room.id}/?token={self._access_token(self.player)}',
            )
            connected, _ = await communicator.connect()
            self.assertTrue(connected)

            await communicator.send_json_to(
                {
                    'event': 'chat_message',
                    'payload': {'message': 'hello from ws'},
                }
            )
            response = await communicator.receive_json_from()
            self.assertEqual(response['event'], 'chat_message')
            self.assertEqual(response['payload']['message'], 'hello from ws')
            self.assertEqual(response['payload']['user']['id'], self.player.id)

            await communicator.disconnect()

        async_to_sync(scenario)()

    def test_room_websocket_rejects_missing_token(self):
        async def scenario():
            communicator = WebsocketCommunicator(application, f'/ws/rooms/{self.room.id}/')
            connected, close_code = await communicator.connect()
            self.assertFalse(connected)
            self.assertEqual(close_code, 4401)

        async_to_sync(scenario)()
