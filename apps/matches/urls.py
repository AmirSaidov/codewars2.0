from rest_framework.routers import DefaultRouter

from .views import MatchViewSet


router = DefaultRouter()
router.register('matches', MatchViewSet, basename='matches')

urlpatterns = router.urls
