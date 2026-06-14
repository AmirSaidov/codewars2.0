from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.coding_tasks.models import CodingTask
from apps.matches.services import start_match
from apps.rooms.models import RoomChatMessage
from apps.rooms.services import create_room, join_room


User = get_user_model()


class RoomExtraEndpointsTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(username='host', password='pass12345')
        self.player = User.objects.create_user(username='player', password='pass12345')
        self.client.force_authenticate(user=self.admin)

        self.room = create_room(self.admin, name='Arena', round_count=3)
        join_room(self.player, self.room)

    def test_messages_endpoint_returns_room_chat_history(self):
        RoomChatMessage.objects.create(room=self.room, user=self.admin, message='hello')
        RoomChatMessage.objects.create(room=self.room, user=self.player, message='gg')

        response = self.client.get(f'/api/rooms/{self.room.id}/messages/')

        self.assertEqual(response.status_code, 200)
        self.assertEqual([item['message'] for item in response.json()], ['hello', 'gg'])

    def test_tournament_endpoint_returns_match_state(self):
        task = CodingTask.objects.create(
            title='Round 1 task',
            description='Tournament opener',
            difficulty=CodingTask.Difficulty.EASY,
        )
        match = start_match(self.admin, self.room, task_ids=[task.id], round_count=1)

        response = self.client.get(f'/api/rooms/{self.room.id}/tournament/')
        data = response.json()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(data['room_id'], self.room.id)
        self.assertEqual(data['status'], match.status)
        self.assertEqual(data['current_round'], 1)
        self.assertEqual(len(data['players']), 1)
        self.assertEqual(data['players'][0]['username'], self.player.username)
