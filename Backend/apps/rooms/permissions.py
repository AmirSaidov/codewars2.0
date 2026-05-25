from rest_framework import permissions


class IsRoomAdmin(permissions.BasePermission):
    message = 'Only room admin can perform this action.'

    def has_object_permission(self, request, view, obj):
        room = getattr(obj, 'room', obj)
        return bool(request.user and request.user.is_authenticated and room.creator_id == request.user.id)
