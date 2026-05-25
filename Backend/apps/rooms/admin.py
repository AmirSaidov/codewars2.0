from django.contrib import admin

from .models import Room, RoomMembership


@admin.register(Room)
class RoomAdmin(admin.ModelAdmin):
    list_display = ['id', 'name', 'creator', 'is_private', 'max_players', 'status', 'created_at']
    list_filter = ['is_private', 'status', 'created_at']
    search_fields = ['name', 'creator__username']
    readonly_fields = ['password_hash', 'created_at', 'updated_at']


@admin.register(RoomMembership)
class RoomMembershipAdmin(admin.ModelAdmin):
    list_display = ['id', 'room', 'user', 'is_ready', 'status', 'joined_at', 'left_at']
    list_filter = ['status', 'is_ready']
    search_fields = ['room__name', 'user__username']
