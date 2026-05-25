from django.conf import settings
from django.db import models


class Submission(models.Model):
    class Status(models.TextChoices):
        ACCEPTED = 'Accepted', 'Accepted'
        WRONG_ANSWER = 'Wrong Answer', 'Wrong Answer'
        RUNTIME_ERROR = 'Runtime Error', 'Runtime Error'
        TIME_LIMIT_EXCEEDED = 'Time Limit Exceeded', 'Time Limit Exceeded'
        COMPILATION_ERROR = 'Compilation Error', 'Compilation Error'

    class ManualDecision(models.TextChoices):
        NONE = '', 'None'
        ACCEPTED = 'accepted', 'Accepted'
        REJECTED = 'rejected', 'Rejected'

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='submissions',
        on_delete=models.CASCADE,
    )
    match = models.ForeignKey(
        'matches.Match',
        related_name='submissions',
        on_delete=models.CASCADE,
    )
    round = models.ForeignKey(
        'matches.Round',
        related_name='submissions',
        on_delete=models.CASCADE,
    )
    task = models.ForeignKey(
        'coding_tasks.CodingTask',
        related_name='submissions',
        on_delete=models.PROTECT,
    )
    code = models.TextField()
    status = models.CharField(max_length=32, choices=Status.choices)
    execution_time = models.FloatField(default=0)
    test_results = models.JSONField(default=list, blank=True)
    submitted_at = models.DateTimeField(auto_now_add=True)
    moderated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='moderated_submissions',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    moderated_at = models.DateTimeField(null=True, blank=True)
    manual_decision = models.CharField(
        max_length=16,
        choices=ManualDecision.choices,
        default=ManualDecision.NONE,
        blank=True,
    )

    class Meta:
        ordering = ['-submitted_at']
        indexes = [
            models.Index(fields=['match', 'round', 'user']),
            models.Index(fields=['status']),
            models.Index(fields=['submitted_at']),
        ]

    def __str__(self):
        return f'{self.user} - {self.status} - round #{self.round_id}'
