from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('submissions', '0001_initial'),
    ]

    operations = [
        migrations.AddConstraint(
            model_name='submission',
            constraint=models.UniqueConstraint(
                fields=('match', 'round', 'user'),
                name='uniq_submission_per_user_per_round',
            ),
        ),
    ]

