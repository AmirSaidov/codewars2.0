from django.conf import settings
from django.db import models


class Match(models.Model):
    class Status(models.TextChoices):
        WAITING = 'waiting', 'Waiting'
        RUNNING = 'running', 'Running'
        FINISHED = 'finished', 'Finished'

    room = models.ForeignKey(
        'rooms.Room',
        related_name='matches',
        on_delete=models.CASCADE,
    )
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.WAITING,
    )
    current_round = models.ForeignKey(
        'matches.Round',
        related_name='+',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    winner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='won_matches',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['room', 'status']),
        ]

    def __str__(self):
        return f'Match #{self.pk} in {self.room}'


class Round(models.Model):
    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        RUNNING = 'running', 'Running'
        FINISHED = 'finished', 'Finished'

    match = models.ForeignKey(
        Match,
        related_name='rounds',
        on_delete=models.CASCADE,
    )
    task = models.ForeignKey(
        'coding_tasks.CodingTask',
        related_name='rounds',
        on_delete=models.PROTECT,
    )
    number = models.PositiveIntegerField()
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.PENDING,
    )
    started_at = models.DateTimeField(null=True, blank=True)
    ended_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['match', 'number'],
                name='unique_round_number_per_match',
            ),
        ]
        ordering = ['number']

    def __str__(self):
        return f'Match #{self.match_id} round {self.number}'


class MatchParticipant(models.Model):
    class Status(models.TextChoices):
        ACTIVE = 'active', 'Active'
        ELIMINATED = 'eliminated', 'Eliminated'
        WINNER = 'winner', 'Winner'
        LEFT = 'left', 'Left'

    match = models.ForeignKey(
        Match,
        related_name='participants',
        on_delete=models.CASCADE,
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='match_participations',
        on_delete=models.CASCADE,
    )
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.ACTIVE,
    )
    score = models.PositiveIntegerField(default=0)
    solved_rounds = models.PositiveIntegerField(default=0)
    total_solution_time = models.FloatField(default=0)
    joined_at = models.DateTimeField(auto_now_add=True)
    eliminated_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['match', 'user'],
                name='unique_match_participant',
            ),
        ]
        indexes = [
            models.Index(fields=['match', 'status']),
            models.Index(fields=['user', 'status']),
        ]
        ordering = ['-score', 'total_solution_time', 'joined_at']

    def __str__(self):
        return f'{self.user} in match #{self.match_id}'


class RoundParticipant(models.Model):
    class Status(models.TextChoices):
        ACTIVE = 'active', 'Active'
        SOLVED = 'solved', 'Solved'
        PASSED = 'passed', 'Passed'
        ELIMINATED = 'eliminated', 'Eliminated'

    round = models.ForeignKey(
        Round,
        related_name='round_participants',
        on_delete=models.CASCADE,
    )
    participant = models.ForeignKey(
        MatchParticipant,
        related_name='round_states',
        on_delete=models.CASCADE,
    )
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.ACTIVE,
    )
    solved_at = models.DateTimeField(null=True, blank=True)
    time_spent = models.FloatField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['round', 'participant'],
                name='unique_round_participant',
            ),
        ]
        indexes = [
            models.Index(fields=['round', 'status']),
        ]

    def __str__(self):
        return f'{self.participant} in round {self.round.number}'
