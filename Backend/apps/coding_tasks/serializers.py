from rest_framework import serializers

from apps.accounts.serializers import UserSerializer

from .models import CodingTask


class CodingTaskSerializer(serializers.ModelSerializer):
    created_by = UserSerializer(read_only=True)
    hidden_tests_count = serializers.SerializerMethodField()

    class Meta:
        model = CodingTask
        fields = [
            'id',
            'title',
            'description',
            'input_format',
            'output_format',
            'examples',
            'visible_tests',
            'hidden_tests',
            'hidden_tests_count',
            'difficulty',
            'time_limit',
            'memory_limit',
            'created_by',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'created_by', 'created_at', 'updated_at', 'hidden_tests_count']

    def get_hidden_tests_count(self, obj):
        return len(obj.hidden_tests or [])

