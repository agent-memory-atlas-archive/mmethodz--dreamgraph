"""Small stdlib validator for the exact schema subset emitted by core's generator."""
import math
from datetime import datetime

def validate(value, schema, path="$", depth=0):
    if depth > 128: raise ValueError("ANALYTICS_SCHEMA_DEPTH_BOUND")
    if "anyOf" in schema:
        for choice in schema["anyOf"]:
            try: validate(value,choice,path,depth+1);return
            except ValueError: pass
        raise ValueError(f"ANALYTICS_SCHEMA_TYPE:{path}")
    if "const" in schema and (value!=schema["const"] or type(value)!=type(schema["const"])): raise ValueError(f"ANALYTICS_SCHEMA_CONST:{path}")
    if "enum" in schema and value not in schema["enum"]: raise ValueError(f"ANALYTICS_SCHEMA_ENUM:{path}")
    kind=schema.get("type")
    types={"object":lambda v:isinstance(v,dict),"array":lambda v:isinstance(v,list),"string":lambda v:isinstance(v,str),"boolean":lambda v:type(v)is bool,"null":lambda v:v is None,"integer":lambda v:type(v)is int,"number":lambda v:type(v)in(int,float) and math.isfinite(v)}
    if kind and (kind not in types or not types[kind](value)):raise ValueError(f"ANALYTICS_SCHEMA_TYPE:{path}")
    if kind=="object":
        properties=schema.get("properties",{})
        if any(key not in value for key in schema.get("required",[])):raise ValueError(f"ANALYTICS_SCHEMA_REQUIRED:{path}")
        for key,item in value.items():
            if "propertyNames" in schema:validate(key,schema["propertyNames"],path+".key",depth+1)
            if key in properties:validate(item,properties[key],path+"."+key,depth+1)
            elif schema.get("additionalProperties") is False:raise ValueError(f"ANALYTICS_SCHEMA_EXTRA:{path}.{key}")
            elif isinstance(schema.get("additionalProperties"),dict):validate(item,schema["additionalProperties"],path+"."+key,depth+1)
    if kind=="array":
        if len(value)<schema.get("minItems",0) or len(value)>schema.get("maxItems",float("inf")):raise ValueError(f"ANALYTICS_SCHEMA_ARRAY_BOUND:{path}")
        for index,item in enumerate(value):validate(item,schema.get("items",{}),path+f"[{index}]",depth+1)
    if kind=="string":
        # JSON Schema lengths are codepoints; JS contract limits use UTF16 units.
        size=len(value.encode("utf-16-le"))//2
        if size<schema.get("minLength",0) or size>schema.get("maxLength",float("inf")):raise ValueError(f"ANALYTICS_SCHEMA_STRING_BOUND:{path}")
        if schema.get("format")=="date-time":
            try:
                parsed=datetime.fromisoformat(value.replace("Z","+00:00"))
                if parsed.tzinfo is None:raise ValueError()
            except ValueError:raise ValueError(f"ANALYTICS_SCHEMA_TIME:{path}")
    if kind in ("integer","number"):
        if value<schema.get("minimum",-float("inf")) or value>schema.get("maximum",float("inf")) or value<=schema.get("exclusiveMinimum",-float("inf")) or value>=schema.get("exclusiveMaximum",float("inf")):raise ValueError(f"ANALYTICS_SCHEMA_NUMBER_BOUND:{path}")
