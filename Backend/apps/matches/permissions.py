from rest_framework import permissions


class IsMatchRoomAdmin(permissions.BasePermission):
    message = 'Only match room admin can perform this action.'

    def has_object_permission(self, request, view, obj):
        return bool(
            request.user
            and request.user.is_authenticated
            and obj.room.creator_id == request.user.id
        )
