from rest_framework import permissions, status, viewsets
from rest_framework.response import Response

from .models import CodingTask
from .serializers import CodingTaskSerializer
from .services import create_task


class CodingTaskViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = CodingTaskSerializer
    http_method_names = ['get', 'post', 'head', 'options']

    def get_queryset(self):
        return CodingTask.objects.select_related('created_by')

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        task = create_task(request.user, **serializer.validated_data)
        return Response(
            CodingTaskSerializer(task, context=self.get_serializer_context()).data,
            status=status.HTTP_201_CREATED,
        )
