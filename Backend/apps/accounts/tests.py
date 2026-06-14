from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.accounts.models import UserProfile


User = get_user_model()


class ProfileApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            username='tester',
            email='tester@example.com',
            password='pass12345',
            first_name='Test',
            last_name='User',
        )
        self.client.force_authenticate(user=self.user)

    def test_me_response_includes_profile_fields(self):
        UserProfile.objects.create(user=self.user, bio='hello', avatar='data:image/png;base64,abc')

        response = self.client.get('/api/auth/me/')

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data['bio'], 'hello')
        self.assertEqual(data['avatar'], 'data:image/png;base64,abc')

    def test_patch_me_updates_user_and_profile(self):
        response = self.client.patch(
            '/api/auth/me/',
            {
                'username': 'updated',
                'email': 'updated@example.com',
                'first_name': 'Updated',
                'last_name': 'Name',
                'bio': 'New bio',
                'avatar': 'data:image/png;base64,xyz',
            },
            format='json',
        )

        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertEqual(self.user.username, 'updated')
        self.assertEqual(self.user.email, 'updated@example.com')
        self.assertEqual(self.user.profile.bio, 'New bio')
        self.assertEqual(self.user.profile.avatar, 'data:image/png;base64,xyz')
