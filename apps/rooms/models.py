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
        return check_password(raw_password or '', self.password_hash)


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
