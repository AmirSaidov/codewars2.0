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

    def test_profile_is_auto_created_for_new_user(self):
        new_user = User.objects.create_user(
            username='newbie',
            email='newbie@example.com',
            password='pass12345',
        )

        self.assertTrue(UserProfile.objects.filter(user=new_user).exists())

    def test_register_auto_creates_profile(self):
        response = self.client.post(
            '/api/auth/register/',
            {
                'username': 'registered',
                'email': 'registered@example.com',
                'password': 'pass12345',
            },
            format='json',
        )

        self.assertEqual(response.status_code, 201)
        user = User.objects.get(username='registered')
        self.assertTrue(UserProfile.objects.filter(user=user).exists())
        self.assertIn('profile', response.json()['user'])

    def test_me_response_includes_profile_fields(self):
        self.user.profile.bio = 'hello'
        self.user.profile.avatar = 'https://example.com/avatar.png'
        self.user.profile.display_name = 'Tester Prime'
        self.user.profile.save(update_fields=['bio', 'avatar', 'display_name', 'updated_at'])

        response = self.client.get('/api/auth/me/')

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data['profile']['bio'], 'hello')
        self.assertEqual(data['profile']['avatar'], 'https://example.com/avatar.png')
        self.assertEqual(data['profile']['display_name'], 'Tester Prime')
        self.assertEqual(data['bio'], 'hello')
        self.assertEqual(data['avatar'], 'https://example.com/avatar.png')
        self.assertEqual(data['display_name'], 'Tester Prime')

    def test_patch_me_updates_user_and_profile(self):
        response = self.client.patch(
            '/api/auth/me/',
            {
                'username': 'updated',
                'email': 'updated@example.com',
                'first_name': 'Updated',
                'last_name': 'Name',
                'profile': {
                    'bio': 'New bio',
                    'avatar': 'https://example.com/new-avatar.png',
                    'display_name': 'Updated Display',
                },
            },
            format='json',
        )

        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertEqual(self.user.username, 'updated')
        self.assertEqual(self.user.email, 'updated@example.com')
        self.assertEqual(self.user.profile.bio, 'New bio')
        self.assertEqual(self.user.profile.avatar, 'https://example.com/new-avatar.png')
        self.assertEqual(self.user.profile.display_name, 'Updated Display')
        self.assertEqual(response.json()['profile']['display_name'], 'Updated Display')

    def test_saved_profile_loads_after_login_from_another_session(self):
        self.client.patch(
            '/api/auth/me/',
            {
                'profile': {
                    'bio': 'Cross-device bio',
                    'avatar': 'https://example.com/cross-device.png',
                    'display_name': 'Cross Device',
                },
            },
            format='json',
        )

        other_client = APIClient()
        login_response = other_client.post(
            '/api/auth/login/',
            {'email': self.user.email, 'password': 'pass12345'},
            format='json',
        )
        self.assertEqual(login_response.status_code, 200)
        other_client.credentials(HTTP_AUTHORIZATION=f"Bearer {login_response.json()['access']}")

        response = other_client.get('/api/auth/me/')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['profile']['bio'], 'Cross-device bio')
        self.assertEqual(response.json()['profile']['avatar'], 'https://example.com/cross-device.png')
        self.assertEqual(response.json()['profile']['display_name'], 'Cross Device')
