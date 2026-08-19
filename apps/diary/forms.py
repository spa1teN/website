from django import forms

from .models import Trip


class TripForm(forms.ModelForm):
    """Create/edit a trip — writes to all language fields via explicit form fields.

    After django-modeltranslation, ``title``/``subtitle``/``description`` are
    descriptors that resolve to the active-language column.  We define
    explicit form fields for both languages (DE/EN) so translations
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

    class Meta:
        model = Trip
        fields = []

    def _get_validation_exclusions(self):
        """Skip model-level validation of the virtual translation fields.

        modeltranslation adds virtual ``title``/``subtitle``/``description``
        fields to ``Trip._meta.fields``.  Because the form declares explicit
        fields with the same names, they would not be auto-excluded from the
        instance ``full_clean()`` in ``_post_clean``.  On create the instance
        is still empty at that point (``Meta.fields = []`` means
        ``construct_instance`` does not copy the cleaned data), so the virtual
        ``title`` would fail with "blank".  The explicit form fields above
        already validate the same content.
        """
        exclude = super()._get_validation_exclusions()
        exclude.update({"title", "subtitle", "description"})
        return exclude

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.instance.pk:
            self.initial["title"] = self.instance.title_de
            self.initial["subtitle"] = self.instance.subtitle_de
            self.initial["description"] = self.instance.description_de
            self.initial["title_en"] = self.instance.title_en
            self.initial["subtitle_en"] = self.instance.subtitle_en
            self.initial["description_en"] = self.instance.description_en

    def save(self, commit=True):
        instance = super().save(commit=False)
        instance.title_de = self.cleaned_data["title"]
        instance.subtitle_de = self.cleaned_data["subtitle"]
        instance.description_de = self.cleaned_data["description"]
        instance.title_en = self.cleaned_data["title_en"]
        instance.subtitle_en = self.cleaned_data["subtitle_en"]
        instance.description_en = self.cleaned_data["description_en"]
        if commit:
            instance.save()
            self._save_m2m()
        return instance
