from django import forms

from .models import Trip


class TripForm(forms.ModelForm):
    class Meta:
        model = Trip
        fields = ["title", "subtitle", "description"]
        widgets = {
            "title": forms.TextInput(attrs={
                "class": "form-control",
                "placeholder": "Titel der Reise",
            }),
            "subtitle": forms.TextInput(attrs={
                "class": "form-control",
                "placeholder": "Untertitel (optional)",
            }),
            "description": forms.Textarea(attrs={
                "class": "form-control",
                "rows": 4,
                "placeholder": "Beschreibung der Reise...",
            }),
        }
