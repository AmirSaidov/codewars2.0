from django.contrib.auth import get_user_model
from django.contrib.auth import authenticate
from django.contrib.auth.models import update_last_login
from django.core.validators import URLValidator
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.settings import api_settings
from rest_framework_simplejwt.tokens import RefreshToken

from .models import UserProfile


User = get_user_model()


def validate_avatar_url(value):
    value = (value or '').strip()
    if not value:
        return ''
    if len(value) > 2048:
        raise serializers.ValidationError('Avatar URL is too long.')
    validator = URLValidator(schemes=['http', 'https'])
    try:
        validator(value)
    except DjangoValidationError as exc:
        raise serializers.ValidationError('Avatar must be a valid http(s) URL.') from exc
    return value


class UserProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = UserProfile
        fields = ['avatar', 'bio', 'display_name', 'created_at', 'updated_at']
        read_only_fields = ['created_at', 'updated_at']


class UserProfileUpdateSerializer(serializers.Serializer):
    avatar = serializers.CharField(required=False, allow_blank=True, trim_whitespace=True)
    bio = serializers.CharField(required=False, allow_blank=True)
    display_name = serializers.CharField(required=False, allow_blank=True, max_length=150)

    def validate_avatar(self, value):
        return validate_avatar_url(value)

    def validate_display_name(self, value):
        return (value or '').strip()


class UserSerializer(serializers.ModelSerializer):
    profile = serializers.SerializerMethodField()
    avatar = serializers.SerializerMethodField()
    bio = serializers.SerializerMethodField()
    display_name = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            'id',
            'username',
            'email',
            'first_name',
            'last_name',
            'is_staff',
            'profile',
            'avatar',
            'bio',
            'display_name',
        ]
        read_only_fields = fields

    def _get_profile(self, obj):
        profile, _ = UserProfile.objects.get_or_create(user=obj)
        return profile

    def get_profile(self, obj):
        return UserProfileSerializer(self._get_profile(obj)).data

    def get_avatar(self, obj):
        profile = self._get_profile(obj)
        return profile.avatar if profile else ''

    def get_bio(self, obj):
        profile = self._get_profile(obj)
        return profile.bio if profile else ''

    def get_display_name(self, obj):
        profile = self._get_profile(obj)
        return profile.display_name if profile else ''


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
        UserProfile.objects.get_or_create(user=user)
        return user


class ProfileUpdateSerializer(serializers.ModelSerializer):
    profile = UserProfileUpdateSerializer(required=False)
    avatar = serializers.CharField(required=False, allow_blank=True, write_only=True)
    bio = serializers.CharField(required=False, allow_blank=True, write_only=True)
    display_name = serializers.CharField(required=False, allow_blank=True, max_length=150, write_only=True)

    class Meta:
        model = User
        fields = ['username', 'email', 'first_name', 'last_name', 'profile', 'bio', 'avatar', 'display_name']

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
        return validate_avatar_url(value)

    def validate_display_name(self, value):
        return (value or '').strip()

    def update(self, instance, validated_data):
        profile, _ = UserProfile.objects.get_or_create(user=instance)
        profile_data = validated_data.pop('profile', {}) or {}

        # Accept legacy flat payloads while making nested profile the canonical API.
        for field in ['bio', 'avatar', 'display_name']:
            if field in validated_data:
                profile_data[field] = validated_data.pop(field)

        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save(update_fields=list(validated_data.keys()) or None)

        profile_updates = []
        for field in ['bio', 'avatar', 'display_name']:
            if field in profile_data:
                setattr(profile, field, profile_data[field])
                profile_updates.append(field)
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
