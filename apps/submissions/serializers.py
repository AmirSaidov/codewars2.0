from rest_framework import serializers

from apps.accounts.serializers import UserSerializer

from .models import Submission


class SubmissionSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)

    class Meta:
        model = Submission
        fields = [
            'id',
            'user',
            'match',
            'round',
            'task',
            'code',
            'status',
            'execution_time',
            'test_results',
            'submitted_at',
            'moderated_by',
            'moderated_at',
            'manual_decision',
        ]
        read_only_fields = fields


class SubmissionCreateSerializer(serializers.Serializer):
    match_id = serializers.IntegerField(min_value=1)
    round_id = serializers.IntegerField(required=False, min_value=1)
    code = serializers.CharField(allow_blank=False)

    def create(self, validated_data):
        from .services import submit_code

        return submit_code(
            self.context['request'].user,
            match_id=validated_data['match_id'],
            round_id=validated_data.get('round_id'),
            code=validated_data['code'],
        )

    def to_representation(self, instance):
        return SubmissionSerializer(instance, context=self.context).data
