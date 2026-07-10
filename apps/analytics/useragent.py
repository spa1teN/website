def parse_user_agent(ua_string):
    """Return (device_type, browser, os) parsed from a User-Agent header.

    Only coarse categories are extracted - no attempt is made to fingerprint
    a specific device or browser build/version.
    """
    if not ua_string:
        return "", "", ""
    try:
        from user_agents import parse as parse_ua
        ua = parse_ua(ua_string)
    except Exception:
        return "", "", ""

    if ua.is_bot:
        device_type = "bot"
    elif ua.is_mobile:
        device_type = "mobile"
    elif ua.is_tablet:
        device_type = "tablet"
    else:
        device_type = "desktop"

    browser = (ua.browser.family or "")[:50]
    os_name = (ua.os.family or "")[:50]
    return device_type, browser, os_name
