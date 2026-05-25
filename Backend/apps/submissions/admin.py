from django.contrib import admin

from .models import Submission


@admin.register(Submission)
class SubmissionAdmin(admin.ModelAdmin):
    list_display = ['id', 'user', 'match', 'round', 'task', 'status', 'execution_time', 'submitted_at']
    list_filter = ['status', 'manual_decision', 'submitted_at']
    search_fields = ['user__username', 'task__title', 'code']
    readonly_fields = ['submitted_at']
