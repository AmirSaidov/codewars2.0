from django.contrib import admin

from .models import Match, MatchParticipant, Round, RoundParticipant


class RoundInline(admin.TabularInline):
    model = Round
    extra = 0


class MatchParticipantInline(admin.TabularInline):
    model = MatchParticipant
    extra = 0


@admin.register(Match)
class MatchAdmin(admin.ModelAdmin):
    list_display = ['id', 'room', 'status', 'current_round', 'winner', 'started_at', 'finished_at']
    list_filter = ['status', 'started_at', 'finished_at']
    search_fields = ['room__name', 'winner__username']
    inlines = [RoundInline, MatchParticipantInline]


@admin.register(Round)
class RoundAdmin(admin.ModelAdmin):
    list_display = ['id', 'match', 'number', 'task', 'status', 'started_at', 'ended_at']
    list_filter = ['status']
    search_fields = ['task__title', 'match__room__name']


@admin.register(MatchParticipant)
class MatchParticipantAdmin(admin.ModelAdmin):
    list_display = ['id', 'match', 'user', 'status', 'score', 'solved_rounds', 'total_solution_time']
    list_filter = ['status']
    search_fields = ['user__username', 'match__room__name']


@admin.register(RoundParticipant)
class RoundParticipantAdmin(admin.ModelAdmin):
    list_display = ['id', 'round', 'participant', 'status', 'solved_at', 'time_spent']
    list_filter = ['status']
    search_fields = ['participant__user__username', 'round__task__title']
