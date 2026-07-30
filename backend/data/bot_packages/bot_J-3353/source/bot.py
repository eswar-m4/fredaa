def run(context):
    return {
        'records': [{'company': 'Example Corp', 'source': context['source']}],
        'execution_metadata': {'rows': 1},
    }
