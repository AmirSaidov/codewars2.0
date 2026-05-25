from .models import CodingTask


def create_task(user, **validated_data):
    return CodingTask.objects.create(created_by=user, **validated_data)
