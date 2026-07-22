from django import forms

from .models import Trip


class TripForm(forms.ModelForm):
    """Create/edit a trip — writes to all language fields via explicit form fields.

    After django-modeltranslation, ``title``/``subtitle``/``description`` are
    descriptors that resolve to the active-language column.  We define
    explicit form fields for all three languages (DE/EN/FI) so translations
    can be entered directly in the trip form without switching to the Django
    admin.
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

    # English translations (all optional — German is the only required language)
    title_en = forms.CharField(
        max_length=255,
        required=False,
        widget=forms.TextInput(attrs={
            "class": "form-control",
            "placeholder": "Trip title",
        }),
    )
    subtitle_en = forms.CharField(
        max_length=255,
        required=False,
        widget=forms.TextInput(attrs={
            "class": "form-control",
            "placeholder": "Subtitle (optional)",
        }),
    )
    description_en = forms.CharField(
        required=False,
        widget=forms.Textarea(attrs={
            "class": "form-control",
            "rows": 4,
            "placeholder": "Trip description...",
        }),
    )

    # Finnish translations (all optional)
    title_fi = forms.CharField(
        max_length=255,
        required=False,
        widget=forms.TextInput(attrs={
            "class": "form-control",
            "placeholder": "Matkan otsikko",
        }),
    )
    subtitle_fi = forms.CharField(
        max_length=255,
        required=False,
        widget=forms.TextInput(attrs={
            "class": "form-control",
            "placeholder": "Alaotsikko (valinnainen)",
        }),
    )
    description_fi = forms.CharField(
        required=False,
        widget=forms.Textarea(attrs={
            "class": "form-control",
            "rows": 4,
            "placeholder": "Matkan kuvaus...",
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
            self.initial["title_en"] = self.instance.title_en
            self.initial["subtitle_en"] = self.instance.subtitle_en
            self.initial["description_en"] = self.instance.description_en
            self.initial["title_fi"] = self.instance.title_fi
            self.initial["subtitle_fi"] = self.instance.subtitle_fi
            self.initial["description_fi"] = self.instance.description_fi

    def save(self, commit=True):
        instance = super().save(commit=False)
        instance.title_de = self.cleaned_data["title"]
        instance.subtitle_de = self.cleaned_data["subtitle"]
        instance.description_de = self.cleaned_data["description"]
        instance.title_en = self.cleaned_data["title_en"]
        instance.subtitle_en = self.cleaned_data["subtitle_en"]
        instance.description_en = self.cleaned_data["description_en"]
        instance.title_fi = self.cleaned_data["title_fi"]
        instance.subtitle_fi = self.cleaned_data["subtitle_fi"]
        instance.description_fi = self.cleaned_data["description_fi"]
        if commit:
            instance.save()
            self._save_m2m()
        return instance
