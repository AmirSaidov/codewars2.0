from django.db.models import Q
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import Submission
from .serializers import SubmissionCreateSerializer, SubmissionSerializer
from .services import accept_submission, reject_submission


class SubmissionViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated]
    http_method_names = ['get', 'post', 'head', 'options']

    def get_queryset(self):
        user = self.request.user
        return (
            Submission.objects.select_related('user', 'match__room', 'round', 'task', 'moderated_by')
            .filter(Q(user=user) | Q(match__room__creator=user))
            .distinct()
        )

    def get_serializer_class(self):
        if self.action == 'create':
            return SubmissionCreateSerializer
        return SubmissionSerializer

    @action(detail=True, methods=['post'])
    def accept(self, request, pk=None):
        submission = accept_submission(request.user, self.get_object())
        return Response(SubmissionSerializer(submission, context=self.get_serializer_context()).data)

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        submission = reject_submission(request.user, self.get_object())
        return Response(SubmissionSerializer(submission, context=self.get_serializer_context()).data)
