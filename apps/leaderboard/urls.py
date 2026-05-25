from django.urls import path

from .views import MatchLeaderboardView, RoomLeaderboardView


urlpatterns = [
    path('leaderboard/rooms/<int:room_id>/', RoomLeaderboardView.as_view(), name='room-leaderboard'),
    path('leaderboard/matches/<int:match_id>/', MatchLeaderboardView.as_view(), name='match-leaderboard'),
]
