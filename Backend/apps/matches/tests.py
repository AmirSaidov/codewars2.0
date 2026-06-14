from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.coding_tasks.models import CodingTask
from apps.matches.models import Match, MatchParticipant
from apps.rooms.models import Room


User = get_user_model()


class MatchLifecycleApiTests(TestCase):
    password = 'pass12345'

    def _register_client(self, username):
        client = APIClient()
        email = f'{username}@example.com'
        register_response = client.post(
            '/api/auth/register/',
            {'username': username, 'email': email, 'password': self.password},
            format='json',
        )
        self.assertEqual(register_response.status_code, 201, register_response.content)

        login_response = client.post(
            '/api/auth/login/',
            {'email': email, 'password': self.password},
            format='json',
        )
        self.assertEqual(login_response.status_code, 200, login_response.content)
        access = login_response.json()['access']
        client.credentials(HTTP_AUTHORIZATION=f'Bearer {access}')
        return client, User.objects.get(username=username)

    def setUp(self):
        self.host_client, self.host = self._register_client('host')
        self.first_client, self.first_player = self._register_client('first')
        self.second_client, self.second_player = self._register_client('second')

        self.first_task = CodingTask.objects.create(
            title='Round 1 task',
            description='Task for round one',
            difficulty=CodingTask.Difficulty.EASY,
        )
        self.second_task = CodingTask.objects.create(
            title='Round 2 task',
            description='Task for round two',
            difficulty=CodingTask.Difficulty.MEDIUM,
        )

    def test_full_match_flow_finishes_with_single_winner_and_results(self):
        create_response = self.host_client.post(
            '/api/rooms/',
            {
                'name': 'Private arena',
                'is_private': True,
                'password': 'secret-code',
                'max_players': 2,
                'round_count': 2,
            },
            format='json',
        )
        self.assertEqual(create_response.status_code, 201, create_response.content)
        room_id = create_response.json()['id']
        self.assertEqual(create_response.json()['invite_code'], str(room_id))

        wrong_password_response = self.first_client.post(
            f'/api/rooms/{room_id}/join/',
            {'password': 'wrong'},
            format='json',
        )
        self.assertEqual(wrong_password_response.status_code, 400)

        for client in [self.first_client, self.second_client]:
            join_response = client.post(
                f'/api/rooms/{room_id}/join/',
                {'password': 'secret-code'},
                format='json',
            )
            self.assertEqual(join_response.status_code, 200, join_response.content)
            ready_response = client.post(f'/api/rooms/{room_id}/ready/', format='json')
            self.assertEqual(ready_response.status_code, 200, ready_response.content)

        forbidden_start_response = self.first_client.post(
            f'/api/rooms/{room_id}/admin/start/',
            {
                'task_ids': [self.first_task.id, self.second_task.id],
                'round_count': 2,
            },
            format='json',
        )
        self.assertEqual(forbidden_start_response.status_code, 403)

        start_response = self.host_client.post(
            f'/api/rooms/{room_id}/admin/start/',
            {
                'task_ids': [self.first_task.id, self.second_task.id],
                'round_count': 2,
            },
            format='json',
        )
        self.assertEqual(start_response.status_code, 201, start_response.content)
        match_id = start_response.json()['match_id']

        room_response = self.host_client.get(f'/api/rooms/{room_id}/')
        self.assertEqual(room_response.status_code, 200)
        self.assertEqual(room_response.json()['status'], Room.Status.RUNNING)
        self.assertEqual(room_response.json()['current_match']['id'], match_id)
        round_one_id = room_response.json()['current_match']['current_round']['id']

        forbidden_advance_response = self.first_client.post(
            f'/api/rooms/{room_id}/admin/advance/',
            {'player_id': self.second_player.id},
            format='json',
        )
        self.assertEqual(forbidden_advance_response.status_code, 403)

        first_submission_response = self.first_client.post(
            '/api/submissions/',
            {'match_id': match_id, 'round_id': round_one_id, 'code': 'print("round one")'},
            format='json',
        )
        self.assertEqual(first_submission_response.status_code, 201, first_submission_response.content)
        accept_response = self.host_client.post(
            f"/api/rooms/{room_id}/admin/submissions/{first_submission_response.json()['id']}/accept/",
            format='json',
        )
        self.assertEqual(accept_response.status_code, 200, accept_response.content)

        pass_response = self.host_client.post(
            f'/api/rooms/{room_id}/admin/advance/',
            {'player_id': self.second_player.id},
            format='json',
        )
        self.assertEqual(pass_response.status_code, 200, pass_response.content)

        tournament_response = self.host_client.get(f'/api/rooms/{room_id}/tournament/')
        self.assertEqual(tournament_response.status_code, 200)
        tournament = tournament_response.json()
        self.assertEqual(tournament['status'], Room.Status.RUNNING)
        self.assertEqual(tournament['current_round'], 2)
        second_tournament_player = next(
            player for player in tournament['players'] if player['user_id'] == self.second_player.id
        )
        self.assertEqual(second_tournament_player['solved_count'], 1)
        self.assertGreaterEqual(second_tournament_player['round_level'], 2)

        room_response = self.host_client.get(f'/api/rooms/{room_id}/')
        round_two_id = room_response.json()['current_match']['current_round']['id']

        first_round_two_submission = self.first_client.post(
            '/api/submissions/',
            {'match_id': match_id, 'round_id': round_two_id, 'code': 'print("winner")'},
            format='json',
        )
        self.assertEqual(first_round_two_submission.status_code, 201, first_round_two_submission.content)
        accept_round_two = self.host_client.post(
            f"/api/submissions/{first_round_two_submission.json()['id']}/accept/",
            format='json',
        )
        self.assertEqual(accept_round_two.status_code, 200, accept_round_two.content)

        second_round_two_submission = self.second_client.post(
            '/api/submissions/',
            {'match_id': match_id, 'round_id': round_two_id, 'code': 'print("lose")'},
            format='json',
        )
        self.assertEqual(second_round_two_submission.status_code, 201, second_round_two_submission.content)
        reject_response = self.host_client.post(
            f"/api/rooms/{room_id}/admin/submissions/{second_round_two_submission.json()['id']}/reject/",
            format='json',
        )
        self.assertEqual(reject_response.status_code, 200, reject_response.content)

        match = Match.objects.get(pk=match_id)
        room = Room.objects.get(pk=room_id)
        self.assertEqual(match.status, Match.Status.FINISHED)
        self.assertEqual(room.status, Room.Status.FINISHED)
        self.assertEqual(match.winner_id, self.first_player.id)
        self.assertEqual(
            MatchParticipant.objects.filter(match=match, status=MatchParticipant.Status.WINNER).count(),
            1,
        )

        result_response = self.host_client.get(f'/api/rooms/{room_id}/result/')
        self.assertEqual(result_response.status_code, 200)
        result = result_response.json()
        self.assertEqual(result['winner']['id'], self.first_player.id)
        self.assertEqual(result['players'][0]['id'], self.first_player.id)
        self.assertEqual(result['players'][0]['rank'], 1)
        self.assertEqual(result['players'][0]['status'], MatchParticipant.Status.WINNER)
        self.assertEqual(result['players'][0]['rounds_solved'], result['players'][0]['solved_count'])
        self.assertEqual(
            len([player for player in result['players'] if player['is_winner']]),
            1,
        )
        self.assertGreater(result['players'][0]['rounds_solved'], 0)

        join_after_finish = self.first_client.post(
            f'/api/rooms/{room_id}/join/',
            {'password': 'secret-code'},
            format='json',
        )
        self.assertEqual(join_after_finish.status_code, 400)

    def test_manual_finish_without_progress_returns_no_winner(self):
        create_response = self.host_client.post(
            '/api/rooms/',
            {'name': 'No progress arena', 'max_players': 2, 'round_count': 1},
            format='json',
        )
        self.assertEqual(create_response.status_code, 201, create_response.content)
        room_id = create_response.json()['id']

        for client in [self.first_client, self.second_client]:
            join_response = client.post(f'/api/rooms/{room_id}/join/', format='json')
            self.assertEqual(join_response.status_code, 200, join_response.content)

        start_response = self.host_client.post(
            f'/api/rooms/{room_id}/admin/start/',
            {'task_ids': [self.first_task.id], 'round_count': 1},
            format='json',
        )
        self.assertEqual(start_response.status_code, 201, start_response.content)
        match_id = start_response.json()['match_id']

        stop_response = self.host_client.post(f'/api/rooms/{room_id}/admin/stop/', format='json')
        self.assertEqual(stop_response.status_code, 200, stop_response.content)

        match = Match.objects.get(pk=match_id)
        self.assertIsNone(match.winner)

        result_response = self.host_client.get(f'/api/rooms/{room_id}/result/')
        self.assertEqual(result_response.status_code, 200)
        result = result_response.json()
        self.assertIsNone(result['winner'])
        self.assertEqual(len(result['players']), 2)
        self.assertEqual(len([player for player in result['players'] if player['is_winner']]), 0)
        self.assertEqual(len([player for player in result['players'] if player['status'] == MatchParticipant.Status.WINNER]), 0)
        self.assertTrue(all(player['rounds_solved'] == 0 for player in result['players']))
        self.assertTrue(all(player['solved_count'] == 0 for player in result['players']))

    def test_manual_finish_with_one_accepted_solution_picks_leader(self):
        create_response = self.host_client.post(
            '/api/rooms/',
            {'name': 'Manual winner arena', 'max_players': 2, 'round_count': 1},
            format='json',
        )
        self.assertEqual(create_response.status_code, 201, create_response.content)
        room_id = create_response.json()['id']

        for client in [self.first_client, self.second_client]:
            join_response = client.post(f'/api/rooms/{room_id}/join/', format='json')
            self.assertEqual(join_response.status_code, 200, join_response.content)

        start_response = self.host_client.post(
            f'/api/rooms/{room_id}/admin/start/',
            {'task_ids': [self.first_task.id], 'round_count': 1},
            format='json',
        )
        self.assertEqual(start_response.status_code, 201, start_response.content)
        match_id = start_response.json()['match_id']

        room_response = self.host_client.get(f'/api/rooms/{room_id}/')
        round_id = room_response.json()['current_match']['current_round']['id']

        submission_response = self.first_client.post(
            '/api/submissions/',
            {'match_id': match_id, 'round_id': round_id, 'code': 'print("accepted")'},
            format='json',
        )
        self.assertEqual(submission_response.status_code, 201, submission_response.content)
        accept_response = self.host_client.post(
            f"/api/rooms/{room_id}/admin/submissions/{submission_response.json()['id']}/accept/",
            format='json',
        )
        self.assertEqual(accept_response.status_code, 200, accept_response.content)

        stop_response = self.host_client.post(f'/api/rooms/{room_id}/admin/stop/', format='json')
        self.assertEqual(stop_response.status_code, 200, stop_response.content)

        match = Match.objects.get(pk=match_id)
        self.assertEqual(match.winner_id, self.first_player.id)

        result_response = self.host_client.get(f'/api/rooms/{room_id}/result/')
        self.assertEqual(result_response.status_code, 200)
        result = result_response.json()
        self.assertEqual(result['winner']['id'], self.first_player.id)
        self.assertEqual(result['players'][0]['id'], self.first_player.id)
        self.assertEqual(result['players'][0]['rank'], 1)
        self.assertEqual(result['players'][0]['rounds_solved'], 1)
        self.assertEqual(len([player for player in result['players'] if player['is_winner']]), 1)
        self.assertEqual(len([player for player in result['players'] if player['status'] == MatchParticipant.Status.WINNER]), 1)

    def test_auth_and_missing_resources_return_expected_errors(self):
        anonymous = APIClient()
        unauthenticated_response = anonymous.get('/api/rooms/')
        self.assertEqual(unauthenticated_response.status_code, 401)

        missing_response = self.host_client.get('/api/rooms/999999/')
        self.assertEqual(missing_response.status_code, 404)
