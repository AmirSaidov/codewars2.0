from django.contrib.auth import get_user_model
from django.contrib.auth import authenticate
from django.contrib.auth.models import update_last_login
from rest_framework import serializers
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.settings import api_settings
from rest_framework_simplejwt.tokens import RefreshToken

from .models import UserProfile


User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    avatar = serializers.SerializerMethodField()
    bio = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'first_name', 'last_name', 'is_staff', 'avatar', 'bio']
        read_only_fields = fields

    def _get_profile(self, obj):
        return UserProfile.objects.filter(user=obj).first()

    def get_avatar(self, obj):
        profile = self._get_profile(obj)
        return profile.avatar if profile else ''

    def get_bio(self, obj):
        profile = self._get_profile(obj)
        return profile.bio if profile else ''


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)

    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'password', 'first_name', 'last_name']
        read_only_fields = ['id']

    def validate_email(self, value):
        if value and User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError('User with this email already exists.')
        return value

    def create(self, validated_data):
        password = validated_data.pop('password')
        user = User(**validated_data)
        user.set_password(password)
        user.save()
        UserProfile.objects.create(user=user)
        return user


class ProfileUpdateSerializer(serializers.ModelSerializer):
    avatar = serializers.CharField(required=False, allow_blank=True)
    bio = serializers.CharField(required=False, allow_blank=True)

    class Meta:
        model = User
        fields = ['username', 'email', 'first_name', 'last_name', 'bio', 'avatar']

    def validate_username(self, value):
        value = (value or '').strip()
        if not value:
            raise serializers.ValidationError('Username is required.')
        queryset = User.objects.filter(username__iexact=value).exclude(pk=self.instance.pk)
        if queryset.exists():
            raise serializers.ValidationError('User with this username already exists.')
        return value

    def validate_email(self, value):
        value = (value or '').strip()
        if not value:
            raise serializers.ValidationError('Email is required.')
        queryset = User.objects.filter(email__iexact=value).exclude(pk=self.instance.pk)
        if queryset.exists():
            raise serializers.ValidationError('User with this email already exists.')
        return value

    def validate_avatar(self, value):
        if not value:
            return ''
        if not value.startswith('data:image/'):
            raise serializers.ValidationError('Avatar must be an image data URL.')
        if len(value) > 2_000_000:
            raise serializers.ValidationError('Avatar is too large.')
        return value

    def update(self, instance, validated_data):
        profile, _ = UserProfile.objects.get_or_create(user=instance)
        bio = validated_data.pop('bio', None)
        avatar = validated_data.pop('avatar', None)

        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save(update_fields=list(validated_data.keys()) or None)

        profile_updates = []
        if bio is not None:
            profile.bio = bio
            profile_updates.append('bio')
        if avatar is not None:
            profile.avatar = avatar
            profile_updates.append('avatar')
        if profile_updates:
            profile.save(update_fields=profile_updates + ['updated_at'])

        return instance


class EmailTokenObtainPairSerializer(serializers.Serializer):
    """
    SimpleJWT login via email + password.

    We lookup the user by email and then authenticate using the username field,
    so we don't need to change Django's AUTHENTICATION_BACKENDS.
    """

    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate(self, attrs):
        email = (attrs.get('email') or '').strip()
        password = attrs.get('password')
        if not email or not password:
            raise serializers.ValidationError('Email and password are required.')

        user = User.objects.filter(email__iexact=email).first()
        if not user or not user.is_active:
            raise AuthenticationFailed('Invalid email or password.')

        authenticated = authenticate(
            request=self.context.get('request'),
            username=user.get_username(),
            password=password,
        )
        if not authenticated:
            raise AuthenticationFailed('Invalid email or password.')

        refresh = RefreshToken.for_user(authenticated)
        data = {
            'refresh': str(refresh),
            'access': str(refresh.access_token),
        }

        if api_settings.UPDATE_LAST_LOGIN:
            update_last_login(None, authenticated)

        return data
