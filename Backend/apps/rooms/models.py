from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.utils import timezone


class Room(models.Model):
    class Status(models.TextChoices):
        WAITING = 'waiting', 'Waiting'
        RUNNING = 'running', 'Running'
        FINISHED = 'finished', 'Finished'

    name = models.CharField(max_length=120)
    creator = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='created_rooms',
        on_delete=models.CASCADE,
    )
    is_private = models.BooleanField(default=False)
    password_hash = models.CharField(max_length=128, blank=True)
    max_players = models.PositiveSmallIntegerField(
        default=10,
        validators=[MinValueValidator(1), MaxValueValidator(10)],
    )
    round_count = models.PositiveSmallIntegerField(
        default=3,
        validators=[MinValueValidator(1), MaxValueValidator(10)],
    )
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.WAITING,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return self.name

    def set_password(self, raw_password):
        self.password_hash = make_password(raw_password) if raw_password else ''

    def check_password(self, raw_password):
        if not self.is_private:
            return True
        if not self.password_hash:
            return False
        try:
            return check_password(raw_password or '', self.password_hash)
        except ValueError:
            return False


class RoomMembership(models.Model):
    class Status(models.TextChoices):
        ACTIVE = 'active', 'Active'
        LEFT = 'left', 'Left'

    room = models.ForeignKey(
        Room,
        related_name='memberships',
        on_delete=models.CASCADE,
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='room_memberships',
        on_delete=models.CASCADE,
    )
    is_ready = models.BooleanField(default=False)
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.ACTIVE,
    )
    joined_at = models.DateTimeField(default=timezone.now)
    left_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['room', 'user'],
                name='unique_room_membership',
            ),
        ]
        indexes = [
            models.Index(fields=['room', 'status']),
            models.Index(fields=['user', 'status']),
        ]
        ordering = ['joined_at']

    def __str__(self):
        return f'{self.user} in {self.room}'

    @property
    def is_active(self):
        return self.status == self.Status.ACTIVE


class RoomSelectedTask(models.Model):
    room = models.ForeignKey(
        Room,
        related_name='selected_tasks',
        on_delete=models.CASCADE,
    )
    task = models.ForeignKey(
        'coding_tasks.CodingTask',
        related_name='selected_in_rooms',
        on_delete=models.CASCADE,
    )
    selected_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='room_selected_tasks',
        on_delete=models.CASCADE,
    )
    position = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['room', 'task'], name='unique_room_selected_task'),
        ]
        indexes = [
            models.Index(fields=['room', 'position', 'created_at']),
        ]
        ordering = ['position', 'created_at']

    def __str__(self):
        return f'{self.task} selected for {self.room}'


class RoomChatMessage(models.Model):
    room = models.ForeignKey(
        Room,
        related_name='chat_messages',
        on_delete=models.CASCADE,
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='room_chat_messages',
        on_delete=models.CASCADE,
    )
    message = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at', 'id']
        indexes = [
            models.Index(fields=['room', 'created_at']),
        ]

    def __str__(self):
        return f'{self.user} @ {self.room}: {self.message[:32]}'
