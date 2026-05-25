from django.conf import settings
from django.db import models


class LeaderboardEntry(models.Model):
    class PlayerStatus(models.TextChoices):
        ACTIVE = 'active', 'Active'
        ELIMINATED = 'eliminated', 'Eliminated'
        WINNER = 'winner', 'Winner'
        LEFT = 'left', 'Left'

    room = models.ForeignKey(
        'rooms.Room',
        related_name='leaderboard_entries',
        on_delete=models.CASCADE,
    )
    match = models.ForeignKey(
        'matches.Match',
        related_name='leaderboard_entries',
        on_delete=models.CASCADE,
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='leaderboard_entries',
        on_delete=models.CASCADE,
    )
    points = models.PositiveIntegerField(default=0)
    solved_count = models.PositiveIntegerField(default=0)
    total_solution_time = models.FloatField(default=0)
    player_status = models.CharField(
        max_length=16,
        choices=PlayerStatus.choices,
        default=PlayerStatus.ACTIVE,
    )
    eliminated = models.BooleanField(default=False)
    last_submission_status = models.CharField(max_length=32, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['match', 'user'],
                name='unique_leaderboard_entry',
            ),
        ]
        ordering = ['-points', 'total_solution_time', 'updated_at']
        indexes = [
            models.Index(fields=['room', 'match']),
            models.Index(fields=['player_status']),
        ]

    def __str__(self):
        return f'{self.user} - {self.points} pts'
