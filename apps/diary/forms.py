from django import forms

from .models import Trip


class TripForm(forms.ModelForm):
    """Create/edit a trip — writes to German fields via explicit form fields.

    After django-modeltranslation, ``title``/``subtitle``/``description`` are
    descriptors that resolve to the active-language column.  The custom
    trip form always saves German (the primary language), so we define
    explicit form fields that read/write ``title_de`` etc. directly.
    Translations for other languages are managed in the Django admin.
    """

    title = forms.CharField(
        max_length=255,
        widget=forms.TextInput(attrs={
            "class": "form-control",
            "placeholder": "Titel der Reise",
        }),
    )
    subtitle = forms.CharField(
        max_length=255,
        required=False,
        widget=forms.TextInput(attrs={
            "class": "form-control",
            "placeholder": "Untertitel (optional)",
        }),
    )
    description = forms.CharField(
        required=False,
        widget=forms.Textarea(attrs={
            "class": "form-control",
            "rows": 4,
            "placeholder": "Beschreibung der Reise...",
        }),
    )

    class Meta:
        model = Trip
        fields = []

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.instance.pk:
            self.initial["title"] = self.instance.title_de
            self.initial["subtitle"] = self.instance.subtitle_de
            self.initial["description"] = self.instance.description_de

    def save(self, commit=True):
        instance = super().save(commit=False)
        instance.title_de = self.cleaned_data["title"]
        instance.subtitle_de = self.cleaned_data["subtitle"]
        instance.description_de = self.cleaned_data["description"]
        if commit:
            instance.save()
            self._save_m2m()
        return instance
