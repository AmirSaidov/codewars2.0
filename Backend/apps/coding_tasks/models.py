from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models


class CodingTask(models.Model):
    class Difficulty(models.TextChoices):
        EASY = 'easy', 'Easy'
        MEDIUM = 'medium', 'Medium'
        HARD = 'hard', 'Hard'

    title = models.CharField(max_length=180)
    description = models.TextField()
    input_format = models.TextField(blank=True)
    output_format = models.TextField(blank=True)
    examples = models.JSONField(default=list, blank=True)
    visible_tests = models.JSONField(default=list, blank=True)
    hidden_tests = models.JSONField(default=list, blank=True)
    difficulty = models.CharField(
        max_length=16,
        choices=Difficulty.choices,
        default=Difficulty.EASY,
    )
    time_limit = models.FloatField(
        default=2.0,
        validators=[MinValueValidator(0.1)],
        help_text='Seconds per test case.',
    )
    memory_limit = models.PositiveIntegerField(
        default=128,
        validators=[MinValueValidator(16)],
        help_text='Megabytes.',
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='created_coding_tasks',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['difficulty', '-created_at']
        indexes = [
            models.Index(fields=['difficulty']),
            models.Index(fields=['created_at']),
        ]

    def __str__(self):
        return self.title
