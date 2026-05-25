from django.contrib import admin

from .models import LeaderboardEntry


@admin.register(LeaderboardEntry)
class LeaderboardEntryAdmin(admin.ModelAdmin):
    list_display = ['id', 'room', 'match', 'user', 'points', 'solved_count', 'player_status', 'eliminated']
    list_filter = ['player_status', 'eliminated']
    search_fields = ['room__name', 'user__username']
