from rest_framework.routers import DefaultRouter

from .views import CodingTaskViewSet


router = DefaultRouter()
router.register('tasks', CodingTaskViewSet, basename='tasks')

urlpatterns = router.urls
