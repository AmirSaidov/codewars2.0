from django.contrib import admin

from .models import CodingTask


@admin.register(CodingTask)
class CodingTaskAdmin(admin.ModelAdmin):
    list_display = ['id', 'title', 'difficulty', 'time_limit', 'memory_limit', 'created_by', 'created_at']
    list_filter = ['difficulty', 'created_at']
    search_fields = ['title', 'description', 'created_by__username']
