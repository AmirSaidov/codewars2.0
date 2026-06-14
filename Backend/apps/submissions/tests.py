from django.contrib.auth import get_user_model
from django.test import TestCase

from apps.coding_tasks.models import CodingTask
from apps.matches.models import Match, MatchParticipant, Round
from apps.rooms.services import create_room, join_room
from apps.matches.services import start_match
from apps.submissions.services import accept_submission, submit_code


User = get_user_model()


class SubmissionModerationTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(username='admin', password='pass12345')
        self.second_player = User.objects.create_user(username='second', password='pass12345')
        self.third_player = User.objects.create_user(username='third', password='pass12345')

        self.room = create_room(self.admin, name='Test room', round_count=2)
        join_room(self.second_player, self.room)
        join_room(self.third_player, self.room)

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

        self.match = start_match(
            self.admin,
            self.room,
            task_ids=[self.first_task.id, self.second_task.id],
            round_count=2,
        )
        self.round_one = self.match.current_round

    def test_accepting_single_submission_does_not_finish_round_while_other_player_has_not_submitted(self):
        submission = submit_code(
            self.third_player,
            match_id=self.match.id,
            round_id=self.round_one.id,
            code='print("ok")',
        )

        accept_submission(self.admin, submission)

        self.match.refresh_from_db()
        self.round_one.refresh_from_db()

        waiting_player = MatchParticipant.objects.get(match=self.match, user=self.second_player)

        self.assertEqual(self.match.status, Match.Status.RUNNING)
        self.assertEqual(self.match.current_round_id, self.round_one.id)
        self.assertEqual(self.round_one.status, Round.Status.RUNNING)
        self.assertIsNone(self.match.winner)
        self.assertEqual(waiting_player.status, MatchParticipant.Status.ACTIVE)
